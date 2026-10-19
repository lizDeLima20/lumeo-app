import { FirebaseAccount, FirebaseAccountError, type FirebaseAccountUser } from "../services/FirebaseAccount";

/**
 * The screen before the library on Android: one "Continuar com Google" button. The first
 * sign-in with an account creates it in Firebase, so there is no separate sign-up form.
 * Nothing of the library is touched here; it opens as it was once the account is in.
 */
export class AccountGateView {
  public constructor(private readonly configured: boolean, private readonly onSignedIn: (user: FirebaseAccountUser) => void) {}

  public render(): HTMLElement {
    const page = document.createElement("section"); page.className = "account-gate";
    const card = document.createElement("div"); card.className = "account-gate__card";
    const brand = document.createElement("div"); brand.className = "account-gate__brand";
    const logo = document.createElement("img"); logo.className = "account-gate__logo"; logo.src = "/icons/lumeo-logo.png"; logo.alt = ""; logo.width = 72; logo.height = 72;
    brand.append(logo);
    const title = document.createElement("h1"); title.className = "account-gate__title"; title.textContent = "Entre na sua conta";
    const copy = document.createElement("p"); copy.className = "account-gate__copy";
    copy.textContent = "Use sua conta Google. Na primeira vez, sua conta Lumeo é criada automaticamente.";
    const button = document.createElement("button"); button.type = "button"; button.className = "button button--google account-gate__google";
    const mark = document.createElement("span"); mark.className = "button--google__mark"; mark.setAttribute("aria-hidden", "true");
    const label = document.createElement("span"); label.textContent = "Continuar com Google";
    button.append(mark, label);
    const status = document.createElement("p"); status.className = "account-gate__status"; status.setAttribute("role", "status");
    const note = document.createElement("p"); note.className = "account-gate__note";
    note.textContent = "Seus livros, HQs e o progresso de leitura continuam neste celular.";
    if (!this.configured) {
      button.disabled = true;
      status.dataset.kind = "error";
      status.textContent = "O login ainda não foi configurado: falta o arquivo google-services.json do Firebase neste app.";
    }
    button.addEventListener("click", () => void (async () => {
      button.disabled = true; page.setAttribute("aria-busy", "true"); label.textContent = "Entrando…";
      status.textContent = ""; delete status.dataset.kind;
      try {
        this.onSignedIn(await FirebaseAccount.signInWithGoogle());
      } catch (error) {
        const cancelled = error instanceof FirebaseAccountError && error.code === "CANCELLED";
        status.dataset.kind = cancelled ? "info" : "error";
        status.textContent = cancelled ? "O Google não concluiu a entrada. Tente novamente; se o problema continuar, verifique a configuração do login."
          : error instanceof Error && error.message ? error.message : "Não foi possível entrar com o Google.";
        button.disabled = false; label.textContent = "Continuar com Google";
      } finally { page.removeAttribute("aria-busy"); }
    })());
    card.append(brand, title, copy, button, status, note);
    page.append(card);
    return page;
  }
}
