import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const app = () => readFileSync("src/core/App.ts", "utf8");
const header = () => readFileSync("src/views/HeaderView.ts", "utf8");
const plugin = () => readFileSync("android/app/src/main/java/com/lumeo/reader/FirebaseAccountPlugin.java", "utf8");
const gradle = () => readFileSync("android/app/build.gradle", "utf8");

describe("conta Lumeo no Android: login obrigatório com Google pelo Firebase", () => {
  it("a biblioteca só abre com a conta, e continua sendo a mesma biblioteca do aparelho", () => {
    const source = app();
    assert.match(source, /const account = FirebaseAccount\.required \? await this\.signedInAccount\(beforeSignIn\) : null;/);
    assert.match(source, /this\.state\.currentUser = \{ id: "personal", email: account\?\.email \?\? "local@lumeo",/, "o id continua personal: livros, arquivos e progresso ficam onde estão");
    assert.match(source, /this\.configureLocalLibrary\("personal"\)/);
  });

  it("sem conta mostra a tela de entrada até o login dar certo", () => {
    assert.match(app(), /if \(state\.user\) return state\.user;\n\s+await beforeSignIn\(\);\n\s+return new Promise\(resolve => \{\n\s+this\.outlet\.replaceChildren\(new AccountGateView\(state\.configured, user => \{ this\.outlet\.replaceChildren\(\); resolve\(user\); \}\)\.render\(\)\);/);
  });

  it("sair só encerra a conta: nada da biblioteca é apagado", () => {
    const source = app();
    assert.match(source, /if \(FirebaseAccount\.required\) \{ await FirebaseAccount\.signOut\(\)\.catch\(\(\) => undefined\); window\.location\.replace\("\/library"\); return; \}/);
    assert.match(header(), /!this\.personalAndroid \|\| Boolean\(this\.account\) \|\| item\.action !== "logout"/, "o Sair aparece com uma conta conectada");
  });

  it("o menu lateral mostra a foto da conta Google e o nome do dono (o e-mail só sem nome)", () => {
    const drawer = readFileSync("src/views/MobileNavigationDrawer.ts", "utf8");
    assert.match(drawer, /const name = this\.account\?\.name\?\.trim\(\) \|\| this\.account\?\.email\?\.trim\(\) \|\| this\.userName;/);
    assert.match(drawer, /avatar\.classList\.add\("drawer-avatar--account"\); avatar\.referrerPolicy = "no-referrer"; avatar\.src = this\.account\.avatarUrl;/);
    assert.match(app(), /\{ name: this\.state\.currentUser\.displayName, email: this\.state\.currentUser\.email, avatarUrl: this\.state\.currentUser\.avatarUrl \}/);
  });

  it("Sair da conta fica no rodapé do menu, sempre visível", () => {
    const drawer = readFileSync("src/views/MobileNavigationDrawer.ts", "utf8");
    assert.match(drawer, /this\.items\.filter\(item => item\.action !== "logout"\)/);
    assert.match(drawer, /this\.account \? "Sair da conta" : this\.i18n\.t\("ui\.navigation\.logout"\)/);
  });

  it("entrar e cadastrar são o mesmo passo: seletor de contas do Android e Firebase Authentication", () => {
    const source = plugin();
    assert.match(source, /new GetSignInWithGoogleOption\.Builder\(webClientId\)/);
    assert.match(source, /FirebaseAuth\.getInstance\(\)\.signInWithCredential\(GoogleAuthProvider\.getCredential\(idToken, null\)\)/);
    assert.match(source, /getIdentifier\("default_web_client_id", "string"/, "o cliente Web vem do google-services.json");
    assert.match(gradle(), /com\.google\.firebase:firebase-auth/);
    assert.match(gradle(), /androidx\.credentials:credentials:1\.3\.0/);
    assert.match(readFileSync("android/app/src/main/java/com/lumeo/reader/MainActivity.java", "utf8"), /registerPlugin\(FirebaseAccountPlugin\.class\);/);
  });

  it("permite cliente Web alternativo apenas no build debug, sem registrar IDs", () => {
    assert.match(gradle(), /debug\s*\{[\s\S]*LUMEO_GOOGLE_TEST_WEB_CLIENT_ID[\s\S]*\.env\.local[\s\S]*resValue 'string', 'lumeo_test_web_client_id'/);
    assert.match(plugin(), /getIdentifier\("lumeo_test_web_client_id", "string"/);
    assert.match(plugin(), /return testClient;/);
    assert.doesNotMatch(plugin(), /Log\.[idw]\([^\n]*\+\s*(?:testClient|defaultId|idToken)/);
  });
});
