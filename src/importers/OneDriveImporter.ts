import type { CloudImportProvider } from "./CloudImportProvider";
import type { ImportedFile } from "./BookImporter";
import { I18nManager } from "../i18n/I18nManager";

export class OneDriveImporter implements CloudImportProvider {
  public readonly providerName = "OneDrive";
  public async selectFile(): Promise<ImportedFile> { throw new Error(I18nManager.shared.t("error.onedrive.notAvailable")); }
}
