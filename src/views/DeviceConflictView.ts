import { AppState } from "../core/AppState";
import { ApiError } from "../services/ApiClient";
import { AuthManager } from "../services/AuthManager";
import { DeviceManager } from "../services/DeviceManager";
import { BaseView } from "./BaseView";
import { GoogleAuthButton } from "./GoogleAuthButton";
import { I18nManager } from "../i18n/I18nManager";

export class DeviceConflictView extends BaseView {
  public constructor(private readonly state: AppState, private readonly auth: AuthManager, private readonly devices: DeviceManager,
    private readonly onResolved: () => void, private readonly onCancel: () => void) { super(); }
  public render(): HTMLElement {
    const section = this.createElement("section", "auth-page page-shell");
    const card = this.createElement("form", "auth-card");
    card.append(this.createElement("span", "eyebrow", this.t("ui.device.securityCheck")),
      this.createElement("h1", "page-title", this.t("ui.device.alreadyLinkedTitle")),
      this.createElement("p", "page-subtitle", this.t("ui.device.alreadyLinkedDescription")));
    if (this.state.conflictingDevice) {
      card.append(this.createElement("p", "device-detail", this.t("ui.device.lastSeen", { device: this.state.conflictingDevice.deviceName, date: new Date(this.state.conflictingDevice.lastSeenAt).toLocaleString(I18nManager.shared.locale) })));
    }
    const label = this.createElement("label", "field"); label.append(this.createElement("span", "field__label", this.t("ui.device.confirmPassword")));
    const password = this.createElement("input", "input") as HTMLInputElement; password.type = "password"; password.required = true; password.autocomplete = "current-password"; label.append(password);
    const error = this.createElement("p", "form-error"); error.setAttribute("role", "alert");
    const replace = this.createElement("button", "button button--primary", this.t("ui.device.useThisDevice")); replace.type = "submit";
    const cancel = this.createElement("button", "button button--secondary", this.t("ui.common.cancel")); cancel.type = "button"; cancel.addEventListener("click", this.onCancel);
    /* A Google account has no password to confirm, so it confirms with Google instead. The
       e-mail must be the one already signed in: confirming with a different Google account
       would otherwise replace the device of the wrong account. */
    const google = new GoogleAuthButton("continue_with", async (credential, nonce) => {
      error.textContent = "";
      const expected = this.state.currentUser?.email?.trim().toLowerCase();
      await this.auth.loginWithGoogle(credential, nonce);
      if (expected && this.state.currentUser?.email?.trim().toLowerCase() !== expected) {
        await this.auth.logout();
        throw new Error(this.t("ui.device.googleAccountMismatch"));
      }
      await this.devices.replace(); this.onResolved();
    }, (message) => { error.textContent = message; }).render();
    card.append(label, error, replace, google, cancel);
    card.addEventListener("submit", async (event) => {
      event.preventDefault(); replace.disabled = true;
      try { await this.auth.reauthenticate(password.value); await this.devices.replace(); this.onResolved(); }
      catch (caught) { error.textContent = caught instanceof ApiError ? caught.message : this.t("ui.device.replaceFailed"); }
      finally { replace.disabled = false; }
    });
    section.append(card); return section;
  }
}
