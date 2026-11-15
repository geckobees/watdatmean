import com.sun.source.util.JavacTask;
import java.util.Arrays;
import java.util.List;
import javax.tools.Diagnostic;
import javax.tools.DiagnosticCollector;
import javax.tools.JavaFileObject;
import javax.tools.ToolProvider;

/** Parse our synthetic repair fixtures with Java 17; never analyze or execute them. */
public class JavaSyntaxCheck {
  public static void main(String[] args) throws Exception {
    var compiler = ToolProvider.getSystemJavaCompiler();
    if (compiler == null) throw new AssertionError("A test JDK is required");
    var diagnostics = new DiagnosticCollector<JavaFileObject>();
    try (var files = compiler.getStandardFileManager(diagnostics, null, java.nio.charset.StandardCharsets.UTF_8)) {
      var task = (JavacTask) compiler.getTask(null, files, diagnostics,
          List.of("-proc:none", "--release", "17"), null, files.getJavaFileObjectsFromStrings(Arrays.asList(args)));
      task.parse();
      var errors = diagnostics.getDiagnostics().stream().filter(d -> d.getKind() == Diagnostic.Kind.ERROR).toList();
      if (!errors.isEmpty()) throw new AssertionError(errors.toString());
    }
    System.out.println("PASS: " + args.length + " proposed corrections parse with the actual Java 17 compiler; no user code or annotation processors executed");
  }
}
