import { BaseView } from "./BaseView";

export class PrivacyView extends BaseView {
  public render(): HTMLElement {
    const main = this.createElement("article", "privacy-page page-shell");
    const heading = this.createElement("header", "privacy-page__heading");
    heading.append(
      this.createElement("span", "eyebrow", "Lumeo"),
      this.createElement("h1", "page-title", "Política de Privacidade"),
      this.createElement("p", "privacy-page__updated", "Última atualização: setembro de 2026."),
      this.createElement("p", "page-subtitle", "O Lumeo Android é uma biblioteca pessoal: seus livros e preferências permanecem no dispositivo, salvo quando você escolhe acessar o Google Drive."),
    );
    main.append(heading);
    this.section(main, "1. Biblioteca pessoal e arquivos locais", [
      "O Lumeo permite que você escolha arquivos PDF, EPUB, CBR e CBZ armazenados no dispositivo. A seleção é feita pelo seletor de arquivos do Android, que concede ao aplicativo acesso somente aos itens escolhidos; o Lumeo não solicita acesso contínuo a todos os arquivos do aparelho.",
      "Os livros selecionados, suas capas, organização por gênero, progresso, preferências, marcadores, destaques e anotações são armazenados no espaço privado local do aplicativo para leitura offline.",
    ]);
    this.section(main, "2. Google Drive", [
      "Quando você cola um link de arquivo ou pasta do Google Drive, o Lumeo solicita autorização oficial do Google pelo fluxo nativo do Android. A autorização é separada da biblioteca local e pode ser recusada ou cancelada.",
      "O aplicativo solicita somente o escopo drive.readonly, usado para listar pastas autorizadas, ler metadados e baixar os arquivos que você escolheu importar. O Lumeo não cria, altera, move ou exclui conteúdo no seu Google Drive.",
      "As chamadas são feitas diretamente à API oficial do Google Drive. O token de acesso é mantido apenas em memória durante a sessão e não é enviado a um servidor próprio do Lumeo.",
    ]);
    this.section(main, "3. Download, capas e leitura offline", [
      "Após a importação, os arquivos baixados do Drive e as capas extraídas ficam no armazenamento privado do aplicativo. Isso permite abrir a biblioteca e ler os livros offline sem baixar novamente o conteúdo já salvo.",
      "O Lumeo não envia PDFs, EPUBs, CBRs, CBZs, capas ou o conteúdo das suas leituras a servidores próprios para importar, baixar ou ler os arquivos.",
    ]);
    this.section(main, "4. Tratamento e exclusão de dados", [
      "A organização da biblioteca e os gêneros são locais: alterar um gênero no Lumeo não modifica as pastas do Google Drive. Remover um livro pelo aplicativo exclui sua cópia local e dados associados ao livro no armazenamento do aplicativo.",
      "Você pode revogar o acesso do Lumeo ao Google Drive nas configurações de segurança da sua Conta Google. A desinstalação do aplicativo ou a limpeza de seus dados remove os dados locais que estiverem no dispositivo.",
    ]);
    this.section(main, "5. Uso limitado dos dados Google", [
      "O acesso aos dados do Google Drive segue a Google API Services User Data Policy, incluindo os requisitos de Limited Use. As informações recebidas do Drive são usadas somente para fornecer a importação solicitada por você e não são vendidas nem usadas para publicidade.",
      "Os serviços do Google seguem suas próprias políticas de privacidade e segurança.",
    ]);
    this.section(main, "6. Segurança", [
      "O Lumeo adota controles técnicos e limita o acesso a dados e credenciais de servidor de acordo com a finalidade de cada componente. Nenhum sistema, contudo, pode garantir segurança absoluta.",
    ]);
    this.section(main, "7. Compartilhamento", [
      "O Lumeo não vende dados pessoais dos usuários.",
      "O fluxo de biblioteca pessoal não depende de Supabase, Vercel, proxy ou catálogo remoto para importar, baixar e ler seus arquivos.",
    ]);
    this.section(main, "8. Direitos do usuário", [
      "O usuário pode solicitar informações relacionadas aos seus dados e, quando aplicável, solicitar correção ou exclusão de informações associadas à sua conta pelo canal oficial de contato da aplicação.",
      "A remoção do aplicativo, dos dados do navegador ou do armazenamento local pode excluir dados mantidos somente no dispositivo.",
    ]);
    this.section(main, "9. Alterações", [
      "Esta Política de Privacidade poderá ser atualizada para refletir mudanças no aplicativo, nos serviços utilizados ou em requisitos legais. A data da revisão mais recente será indicada nesta página.",
    ]);
    this.section(main, "10. Contato", [
      "Para questões relacionadas à privacidade ou ao funcionamento do Lumeo, utilize o canal de contato oficial informado pela aplicação.",
    ]);
    return main;
  }

  private section(root: HTMLElement, title: string, paragraphs: readonly string[]): void {
    const section = this.createElement("section", "privacy-page__section");
    section.append(this.createElement("h2", "privacy-page__title", title), ...paragraphs.map((text) => this.createElement("p", "", text)));
    root.append(section);
  }
}
