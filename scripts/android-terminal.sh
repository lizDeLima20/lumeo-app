#!/usr/bin/env bash
# Terminal-only Android workflow for Lumeo. It intentionally never opens
# Android Studio and always launches Gradle with JDK 21.
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
default_java_home="/home/delima/.local/jdks/lumeo-jdk21/usr/lib/jvm/java-21-openjdk-amd64"
export JAVA_HOME="${LUMEO_JAVA_HOME:-$default_java_home}"
export PATH="$JAVA_HOME/bin:$PATH"
apk_path="$project_root/android/app/build/outputs/apk/debug/app-debug.apk"
package_name="com.lumeo.reader"

require_java_21() {
  if [[ ! -x "$JAVA_HOME/bin/java" || ! -x "$JAVA_HOME/bin/javac" ]]; then
    echo "JDK 21 não encontrado em: $JAVA_HOME" >&2
    echo "Defina LUMEO_JAVA_HOME para um JDK 21 válido." >&2
    exit 1
  fi
  local version
  version="$($JAVA_HOME/bin/java -version 2>&1 | sed -n '1s/.*version "\([0-9][0-9]*\).*/\1/p')"
  if [[ "$version" != "21" ]]; then
    echo "O projeto Android exige Java 21; JAVA_HOME atual é Java ${version:-desconhecido}." >&2
    exit 1
  fi
}

java_info() {
  require_java_21
  echo "JAVA_HOME=$JAVA_HOME"
  java -version
  javac -version
}

sync_android() {
  require_java_21
  cd "$project_root"
  npm run build:android
  npx cap sync android
}

build_apk() {
  sync_android
  cd "$project_root/android"
  ./gradlew --no-daemon assembleDebug
  test -f "$apk_path"
  echo "APK=$apk_path"
}

# Signed production APK. The key stays in ~/.lumeo/release (or LUMEO_RELEASE_KEYSTORE_PROPERTIES);
# the APK is copied out only after apksigner accepts it and its certificate is that key's.
release_apk() {
  local properties="${LUMEO_RELEASE_KEYSTORE_PROPERTIES:-$HOME/.lumeo/release/keystore.properties}"
  local release_apk_path="$project_root/android/app/build/outputs/apk/release/app-release.apk"
  local output="${LUMEO_RELEASE_OUTPUT:-$HOME/Downloads/Lumeo-Android.apk}"
  test -f "$properties" || { echo "Configuração de assinatura não encontrada: $properties" >&2; exit 1; }
  local build_tools
  build_tools="$(ls -d "${ANDROID_HOME:-$HOME/Android/Sdk}"/build-tools/* | sort -V | tail -1)"
  sync_android
  cd "$project_root/android"
  rm -f "$release_apk_path"
  ./gradlew --no-daemon assembleRelease
  test -f "$release_apk_path" || { echo "APK assinado não foi gerado (o release saiu sem assinatura?)." >&2; exit 1; }
  "$build_tools/apksigner" verify --verbose --print-certs "$release_apk_path" 2>/dev/null | grep -E "Verified using|[Ss]igner.*certificate (DN|SHA-256)"
  # The certificate in the APK must be the Lumeo release key, never the debug one.
  local store alias apk_sha key_sha
  store="$(grep '^storeFile=' "$properties" | cut -d= -f2-)"; alias="$(grep '^keyAlias=' "$properties" | cut -d= -f2-)"
  # apksigner prints "Signer #1 certificate ..." or "V2 Signer: certificate ..." depending on version.
  apk_sha="$("$build_tools/apksigner" verify --print-certs "$release_apk_path" 2>/dev/null | sed -n 's/^.*[Ss]igner.*certificate SHA-256 digest: //p' | head -1)"
  key_sha="$(LUMEO_KS_PASS="$(grep '^storePassword=' "$properties" | cut -d= -f2-)" keytool -list -v -keystore "$store" -alias "$alias" -storepass:env LUMEO_KS_PASS 2>/dev/null | sed -n 's/^[[:space:]]*SHA256: //p' | tr -d ':' | tr 'A-F' 'a-f')"
  [[ -n "$apk_sha" && "$apk_sha" == "$key_sha" ]] || { echo "O certificado do APK não é o da chave de release do Lumeo." >&2; exit 1; }
  mkdir -p "$(dirname "$output")"
  cp "$release_apk_path" "$output"
  echo "APK_RELEASE=$output"
  sha256sum "$output"
}

require_device() {
  local device_count
  device_count="$(adb devices | awk 'NR>1 && $2 == "device" { count++ } END { print count + 0 }')"
  if [[ "$device_count" == "0" ]]; then
    echo "Nenhum dispositivo Android autorizado. Conecte o celular, habilite Depuração USB e aceite a chave RSA." >&2
    exit 1
  fi
}

install_apk() {
  test -f "$apk_path" || { echo "APK não encontrado: rode npm run android:build primeiro." >&2; exit 1; }
  require_device
  adb install -r "$apk_path"
}

start_app() {
  require_device
  adb shell monkey -p "$package_name" -c android.intent.category.LAUNCHER 1 >/dev/null
  echo "Aplicativo iniciado: $package_name"
}

case "${1:-}" in
  java) java_info ;;
  sync) sync_android ;;
  build) build_apk ;;
  release) release_apk ;;
  install) install_apk ;;
  logs)
    require_device
    exec adb logcat -v color -s NativeBookDownload:V Lumeo:V Capacitor:V chromium:W '*:S'
    ;;
  dev)
    build_apk
    install_apk
    start_app
    ;;
  *)
    echo "Uso: $0 {java|sync|build|install|logs|dev}" >&2
    exit 64
    ;;
esac
