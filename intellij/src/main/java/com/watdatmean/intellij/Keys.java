package com.watdatmean.intellij;

import com.intellij.credentialStore.CredentialAttributes;
import com.intellij.ide.passwordSafe.PasswordSafe;

/** Call only on a background thread; credentials never enter the browser or settings XML. */
final class Keys {
  private static CredentialAttributes attributes(String provider) {
    return new CredentialAttributes("WatDatMean/" + provider);
  }
  static String get(String provider) { return PasswordSafe.getInstance().getPassword(attributes(provider)); }
  static void set(String provider, String key) { PasswordSafe.getInstance().setPassword(attributes(provider), key); }
}
