package com.watdatmean.intellij;

import com.intellij.openapi.editor.colors.*;
import com.intellij.openapi.editor.DefaultLanguageHighlighterColors;
import com.intellij.openapi.editor.markup.TextAttributes;
import com.intellij.ide.highlighter.JavaHighlightingColors;
import com.intellij.openapi.fileTypes.FileTypeManager;
import com.intellij.openapi.project.ProjectManager;
import com.intellij.testFramework.LightVirtualFile;
import com.google.gson.JsonObject;
import java.awt.Color;

final class CodeColorsSmoke {
  static void run() {
    // Production deliberately falls back when its 150 ms highlighting budget is
    // exceeded. Initialize lazy Java PSI/highlighters before asserting exact colors.
    var warmProject=ProjectManager.getInstance().getDefaultProject();
    String warmCode="class Warm { int field; void run(int input) { int local = input; field = local; run(local); } }";
    var warmFile=new LightVirtualFile("Warm.java",FileTypeManager.getInstance().getFileTypeByExtension("java"),warmCode);
    for(int i=0;i<2;i++)CodeColors.highlight(warmProject,warmFile,warmCode,0,warmCode.length());
    var manager=EditorColorsManager.getInstance();var original=manager.getGlobalScheme();
    try {
      for(String name:new String[]{"Default","Darcula"}) {
        var scheme=(EditorColorsScheme)manager.getScheme(name).clone();
        scheme.setAttributes(DefaultLanguageHighlighterColors.KEYWORD,new TextAttributes(new Color(0x123456),null,null,null,0));
        scheme.setAttributes(JavaHighlightingColors.CLASS_NAME_ATTRIBUTES,new TextAttributes(new Color(0x234561),null,null,null,0));
        scheme.setAttributes(JavaHighlightingColors.METHOD_DECLARATION_ATTRIBUTES,new TextAttributes(new Color(0x234562),null,null,null,0));
        scheme.setAttributes(JavaHighlightingColors.METHOD_CALL_ATTRIBUTES,new TextAttributes(new Color(0x234563),null,null,null,0));
        scheme.setAttributes(JavaHighlightingColors.LOCAL_VARIABLE_ATTRIBUTES,new TextAttributes(new Color(0x234564),null,null,null,0));
        scheme.setAttributes(JavaHighlightingColors.PARAMETER_ATTRIBUTES,new TextAttributes(new Color(0x234565),null,null,null,0));
        scheme.setAttributes(JavaHighlightingColors.INSTANCE_FIELD_ATTRIBUTES,new TextAttributes(new Color(0x234566),null,null,null,0));
        manager.setGlobalScheme(scheme);
        String java="public class Demo { String text = \"雪\"; int n = 42; }";
        var file=new LightVirtualFile("Demo.java",FileTypeManager.getInstance().getFileTypeByExtension("java"),java);
        var colors=CodeColors.highlight(ProjectManager.getInstance().getDefaultProject(),file,java,0,java.length());
        check(colors.getAsJsonArray("runs").size()>5,"Native Java token ranges");
        check(colorAt(colors,0).equals("#123456"),"Custom native keyword color under "+name);
        var snapshotColors = CodeColors.snippet(warmProject, "Java", java);
        check(colorAt(snapshotColors,0).equals("#123456"),"Independent examples and snapshots use the native Java palette under "+name);
        check(!colorAt(colors,java.indexOf("雪")).equals("#123456"),"Strings keep their own native color");
        String roles="class Roles { int field; void run(int input) { int local = input; field = local; run(local); } }";
        var named=CodeColors.highlight(ProjectManager.getInstance().getDefaultProject(),file,roles,0,roles.length());
        check(colorAt(named,roles.indexOf("Roles")).equals("#234561"),"Native class declaration scheme key");
        check(colorAt(named,roles.indexOf("run")).equals("#234562"),"Native method declaration scheme key");
        check(colorAt(named,roles.lastIndexOf("run")).equals("#234563"),"Native method call scheme key");
        check(colorAt(named,roles.indexOf("local")).equals("#234564")&&colorAt(named,roles.lastIndexOf("local")).equals("#234564"),"Local variable declarations and references");
        check(colorAt(named,roles.indexOf("input")).equals("#234565")&&colorAt(named,roles.lastIndexOf("input")).equals("#234565"),"Parameter declarations and references");
        check(colorAt(named,roles.indexOf("field")).equals("#234566")&&colorAt(named,roles.lastIndexOf("field")).equals("#234566"),"Field declarations and references");
        String draft="class Roles { void run(int field) { int changed = field; } }";
        var edited=CodeColors.highlight(ProjectManager.getInstance().getDefaultProject(),file,draft,0,draft.length());
        check(colorAt(edited,draft.lastIndexOf("field")).equals("#234565"),"Edited draft is analyzed using its own parameter scope");
        String comment="/* first\r\nreturn 2;\r\n*/";int start=comment.indexOf("return");
        var partial=CodeColors.highlight(ProjectManager.getInstance().getDefaultProject(),file,comment,start,start+9);
        check(!colorAt(partial,0).equals("#123456"),"Multiline selection uses surrounding lexical context");
        check(CodeColors.highlight(ProjectManager.getInstance().getDefaultProject(),file,"x".repeat(50001),0,50001).getAsJsonArray("runs").isEmpty(),"Large snippets safely stay plain");
      }
      System.out.println("PASS: native 2022.3 Java colors, light/dark schemes, class/method/variable/parameter/field roles, edited draft scopes, Unicode, partial comment context and limits");
    } finally { manager.setGlobalScheme(original); }
  }
  static String colorAt(JsonObject result,int offset) {
    for(var value:result.getAsJsonArray("runs")) {
      var run=value.getAsJsonArray();
      if(run.get(0).getAsInt()<=offset&&run.get(1).getAsInt()>offset)return result.getAsJsonArray("styles").get(run.get(2).getAsInt()).getAsJsonObject().get("color").getAsString();
    }
    throw new AssertionError("No colored token at "+offset);
  }
  private static void check(boolean valid,String label){if(!valid)throw new AssertionError(label);}
}
