package com.watdatmean.intellij;

import com.intellij.openapi.project.Project;
import com.intellij.openapi.ui.DialogWrapper;
import com.intellij.openapi.ui.ValidationInfo;
import com.intellij.util.ui.FormBuilder;
import javax.swing.*;

final class ConfigureDialog extends DialogWrapper {
  final JComboBox<String> provider = new JComboBox<>(new String[]{"openai", "anthropic", "groq"});
  final JTextField model = new JTextField(30);
  final JTextField nodePath = new JTextField(30);
  final JCheckBox autoDownloadNode = new JCheckBox("Automatically download Node.js if no compatible runtime is found");
  final JPasswordField key = new JPasswordField(30);
  ConfigureDialog(Project project) {
    super(project);
    var state = Settings.get().getState();
    provider.setSelectedItem(state.provider);
    model.setText(state.model.isBlank() ? Settings.defaultModel(state.provider) : state.model);
    nodePath.setText(state.nodePath);
    autoDownloadNode.setSelected(state.autoDownloadNode);
    provider.addActionListener(event -> model.setText(Settings.defaultModel((String) provider.getSelectedItem())));
    setTitle("WatDatMean · Provider and Node.js");
    init();
  }
  @Override protected JComponent createCenterPanel() {
    return FormBuilder.createFormBuilder()
      .addLabeledComponent("Provider", provider)
      .addLabeledComponent("Model ID", model)
      .addLabeledComponent("API key (blank keeps existing)", key)
      .addLabeledComponent("Node.js 22.12+ executable", nodePath)
      .addComponent(autoDownloadNode)
      .addComponent(new JLabel("Keys use IntelliJ Password Safe. AI sends code only when you request help."))
      .addComponent(new JLabel("Leave blank for automatic detection. Downloads stay private to WatDatMean."))
      .getPanel();
  }
  @Override protected ValidationInfo doValidate() {
    if (model.getText().isBlank() || model.getText().length() > 200) return new ValidationInfo("Enter a model ID under 200 characters.", model);
    String password = new String(key.getPassword()).trim();
    if (password.matches(".*\\s.*") || password.length() > 2000) return new ValidationInfo("Enter an API key without whitespace.", key);
    return null;
  }
}
