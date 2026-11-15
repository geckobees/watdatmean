package com.watdatmean.intellij;

import com.intellij.codeInsight.documentation.*;
import com.intellij.ide.highlighter.JavaHighlightingColors;
import com.intellij.ide.ui.LafManager;
import com.intellij.ide.impl.OpenProjectTask;
import com.intellij.ide.impl.TrustedPathsSettings;
import com.intellij.lang.documentation.*;
import com.intellij.lang.java.JavaDocumentationProvider;
import com.intellij.openapi.editor.EditorFactory;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.editor.colors.EditorColorsManager;
import com.intellij.openapi.fileEditor.FileDocumentManager;
import com.intellij.openapi.fileTypes.FileTypeManager;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.project.DumbService;
import com.intellij.openapi.project.ex.ProjectManagerEx;
import com.intellij.openapi.util.Disposer;
import com.intellij.psi.*;
import com.intellij.testFramework.LightVirtualFile;
import com.intellij.ui.ColorUtil;
import java.awt.*;
import java.awt.image.BufferedImage;
import java.nio.file.*;
import java.util.regex.Pattern;
import javax.imageio.ImageIO;

/** Checks the registered native documentation pipeline on both supported IDE baselines. */
final class HoverSmoke {
  static void run() throws Exception {
    var manager = ProjectManagerEx.getInstanceEx();
    var projectPath = Path.of(System.getProperty("watdatmean.test.result")).resolveSibling("hover-project");
    // Only this fixture path in the test-only IDE profile; never alter the user's project trust.
    ApplicationManager.getApplication().getService(TrustedPathsSettings.class).addTrustedPath(projectPath.toString());
    var project = manager.openProject(projectPath, new OpenProjectTask(true, null, true, false));
    check(project != null, "Isolated hover test project");
    try {
      var finished = new java.util.concurrent.CompletableFuture<Void>();
      DumbService.getInstance(project).smartInvokeLater(() -> {
        try { checkHover(project); JavaPartsSmoke.run(project); JavaOriginsSmoke.run(project); ExtremeSmoke.run(project); EditSmoke.run(project); NavigationSmoke.run(project); finished.complete(null); }
        catch (Throwable error) { finished.completeExceptionally(error); }
      });
      finished.get(60, java.util.concurrent.TimeUnit.SECONDS);
      SemanticSmoke.run(project);
      LineHighlightSmoke.run(project);
    } finally { ApplicationManager.getApplication().invokeAndWait(() -> manager.forceCloseProject(project, false)); }
  }
  private static void checkHover(Project project) {
    String source = """
      class HoverDemo {
        /** Doubles the supplied value.
         * @param value the input number
         * @return twice the input
         */
        static int doubleIt(int value) { return value * 2; }
        void demo() {
          int score = 3;
          final String text = "<img src=x>";
          String[] labels = new String[3];
          HoverDemo example = new HoverDemo();
          print(doubleIt(score));
          print(score);
          if (score > 0) { print(score); }
        }
        void print(int number) {}
      }
      """;
    var virtual = new LightVirtualFile("HoverDemo.java", FileTypeManager.getInstance().getFileTypeByExtension("java"), source);
    var document = FileDocumentManager.getInstance().getDocument(virtual);
    var file = (PsiJavaFile) PsiManager.getInstance(project).findFile(virtual);
    var method = file.getClasses()[0].findMethodsByName("doubleIt", false)[0];
    var origin = file.findElementAt(source.indexOf("doubleIt"));
    var provider = DocumentationManager.getProviderFromElement(method, origin);
    String nativeHtml = new JavaDocumentationProvider().generateHoverDoc(method, origin);
    if (nativeHtml == null) nativeHtml = new JavaDocumentationProvider().generateDoc(method, origin);
    String html = provider.generateHoverDoc(method, origin);
    check(html != null && html.contains("WatDatMean"), "Registered Java provider participates in native hover");
    check(html.contains("Doubles the supplied value"), "Javadoc preserved");
    check(html.contains("takes") && html.contains("is declared to return"), "Short method explanation");
    int block = html.indexOf(DocumentationMarkup.CONTENT_START + "<p><b>WatDatMean");
    int end = html.indexOf(DocumentationMarkup.CONTENT_END, block) + DocumentationMarkup.CONTENT_END.length();
    check((html.substring(0, block) + html.substring(end)).equals(nativeHtml), "Native documentation preserved exactly");
    check(block > html.indexOf(DocumentationMarkup.DEFINITION_START), "Native signature remains first");
    String quickDoc = provider.generateDoc(method, origin);
    check(quickDoc.contains("WatDatMean") && quickDoc.contains("twice the input"), "Keyboard Quick Documentation retains return section");
    check(java.util.Objects.equals(provider.getQuickNavigateInfo(method, origin), new JavaDocumentationProvider().getQuickNavigateInfo(method, origin)), "Ctrl-hover navigation preserved");

    var link = Pattern.compile("href=\"(watdatmean://learn/[^\"]+)\"").matcher(html);
    check(link.find(), "One learning panel link");
    check(HoverLinks.get(project).resolve(link.group(1)) == origin, "Panel link refers to hovered source");
    check(HoverLinks.get(project).resolve("watdatmean://learn/unknown") == null, "Unknown link cannot select source");
    check(((ExternalDocumentationHandler) provider).handleExternalLink(PsiManager.getInstance(project), "watdatmean://learn/unknown", origin), "Native documentation dispatches learning links");
    check(!((ExternalDocumentationHandler) provider).handleExternalLink(PsiManager.getInstance(project), "https://example.com", origin), "Other documentation links remain with IntelliJ");

    var callOrigin = file.findElementAt(source.indexOf("doubleIt(score)"));
    String callHtml = provider.generateHoverDoc(method, callOrigin);
    check(callHtml.contains("inner call") && callHtml.contains("outer call") && callHtml.contains("inner call's result"), "Nested calls explained at the usage site");
    var callLink = Pattern.compile("href=\"(watdatmean://learn/[^\"]+)\"").matcher(callHtml);
    check(callLink.find() && HoverLinks.get(project).resolve(callLink.group(1)) == callOrigin, "Resolved method docs still open the hovered call");
    String simple = JavaHover.explain(file.findElementAt(source.indexOf("print(score)")));
    check(simple.startsWith("The call to ") && simple.contains("receives"), "Simple call explanation");
    String escaped = JavaHover.explain(file.findElementAt(source.indexOf("text =")));
    check(escaped.contains("&lt;img src=x&gt;") && !escaped.contains("<img"), "Source rendered as escaped text");
    check(escaped.contains("does not freeze"), "Final reference does not promise immutable contents");
    check(JavaHover.explain(file.findElementAt(source.indexOf("labels ="))).contains("creates an array"), "Reference arrays do not call the element constructor");
    check(JavaHover.explain(file.findElementAt(source.indexOf("example ="))).contains("constructor to create an object"), "Object construction and reference explained");
    check(JavaHover.explain(file.findElementAt(source.indexOf("Doubles"))) == null, "Javadoc comments not reinterpreted");
    var plain = PsiFileFactory.getInstance(project).createFileFromText("notes.txt", "plain text");
    check(JavaHover.explain(plain.getFirstChild()) == null, "Other languages keep their native hover");
    String longCode = JavaHover.code("x".repeat(300), JavaHighlightingColors.LOCAL_VARIABLE_ATTRIBUTES);
    check(longCode.contains("…") && !longCode.contains("x".repeat(57)), "Long expressions stay compact");
    var broken = PsiFileFactory.getInstance(project).createFileFromText("Broken.java", FileTypeManager.getInstance().getFileTypeByExtension("java"), "class Broken { void run() { int score = ; } }");
    check(JavaHover.explain(broken.findElementAt(broken.getText().indexOf("score"))).contains("incomplete"), "Incomplete source has a safe explanation");

    var editor = EditorFactory.getInstance().createEditor(document, project);
    try {
      int offset = source.indexOf("return value");
      var keyword = file.findElementAt(offset);
      check(provider.getCustomDocumentationElement(editor, file, keyword, offset) == keyword, "Statement keywords receive native hover targets");
      check(new HoverDocumentation().getCustomDocumentationElement(editor, file, origin, origin.getTextOffset()) == null, "Symbol resolution remains native");
      check(provider.generateHoverDoc(keyword, keyword).contains("back to its caller"), "Return keyword hover");
    } finally { EditorFactory.getInstance().releaseEditor(editor); }

    if (Boolean.getBoolean("watdatmean.test.ui")) renderThemes(project, method, origin, provider);
    var links = HoverLinks.get(project);
    String old = links.remember(origin);
    for (int i = 0; i < 80; i++) links.remember(origin);
    check(links.resolve(old) == null, "Retained hover source pointers are bounded");
    System.out.println("PASS: native hover, preserved Javadoc/navigation, local Java explanations, theme colors, escaped source, bounded panel links");
  }

  private static void renderThemes(Project project, PsiElement method, PsiElement origin, DocumentationProvider provider) {
    var colors = EditorColorsManager.getInstance();
    var original = colors.getGlobalScheme();
    var laf = LafManager.getInstance();
    Object originalLaf = theme(laf, null);
    try {
      for (String name : new String[]{"IntelliJ", "Darcula"}) {
        setTheme(laf, theme(laf, name.equals("Darcula")));
        var scheme = colors.getScheme(name.equals("IntelliJ") ? "Default" : "Darcula");
        check(scheme != null, "Built-in editor theme " + name);
        colors.setGlobalScheme(scheme);
        String html = provider.generateHoverDoc(method, origin);
        var keywordColor = scheme.getAttributes(JavaHighlightingColors.KEYWORD).getForegroundColor();
        check(html.contains("color:#" + ColorUtil.toHex(keywordColor)), "Hover follows " + name + " keyword color");
        var component = new DocumentationComponent(DocumentationManager.getInstance(project));
        try {
          component.setText(html, method, provider);
          int width = 540;
          int height = Math.max(160, Math.min(700, component.getPreferredHeight(width)));
          component.setSize(width, height);
          layout(component);
          var image = new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB);
          var graphics = image.createGraphics();
          component.printAll(graphics); graphics.dispose();
          Color background = component.getBackground();
          check((background.getRed() > 128) == name.equals("IntelliJ"), "Native popup background follows light/dark theme");
          Path output = Path.of(System.getProperty("watdatmean.test.result")).resolveSibling("hover-" + name.toLowerCase(java.util.Locale.ROOT) + ".png");
          ImageIO.write(image, "png", output.toFile());
        } finally { Disposer.dispose(component); }
      }
    } catch (Exception error) { throw new AssertionError("Native hover rendering", error); }
    finally { setTheme(laf, originalLaf); colors.setGlobalScheme(original); }
  }
  // Theme-switching APIs changed after 2022.3. Reflection stays in tests, never in the shipped plugin.
  static Object theme(LafManager laf, Boolean dark) {
    try {
      return LafManager.class.getMethod(dark == null ? "getCurrentUIThemeLookAndFeel" : dark ? "getDefaultDarkLaf" : "getDefaultLightLaf").invoke(laf);
    } catch (NoSuchMethodException olderIde) {
      return dark == null ? laf.getCurrentLookAndFeel() : java.util.Arrays.stream(laf.getInstalledLookAndFeels())
        .filter(candidate -> dark ? candidate.getName().equals("Darcula") : candidate.getName().contains("Light")).findFirst().orElseThrow();
    } catch (ReflectiveOperationException error) { throw new AssertionError(error); }
  }
  static void setTheme(LafManager laf, Object theme) {
    try {
      var setter = java.util.Arrays.stream(LafManager.class.getMethods()).filter(method -> method.getName().equals("setCurrentLookAndFeel")
        && method.getParameterCount() == 2 && method.getParameterTypes()[0].isInstance(theme)).findFirst().orElseThrow();
      setter.invoke(laf, theme, false); laf.updateUI();
    } catch (ReflectiveOperationException error) { throw new AssertionError(error); }
  }
  private static void layout(Container component) {
    component.doLayout();
    for (Component child : component.getComponents()) if (child instanceof Container container) layout(container);
  }
  private static void check(boolean condition, String message) {
    if (!condition) throw new AssertionError(message);
  }
}
