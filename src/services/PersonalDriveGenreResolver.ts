/** Folder names are user data: known spelling variants get a useful common label, while
 * unfamiliar names stay intact instead of being guessed into the wrong genre. */
const aliases: Record<string, string> = {
  historia: "História", autoajuda: "Autoajuda", "auto ajuda": "Autoajuda",
  "desenvolvimento pessoal": "Desenvolvimento Pessoal", saude: "Saúde", educacao: "Educação",
  romance: "Romance", "ficcao cientifica": "Ficção Científica", fantasia: "Fantasia", terror: "Terror",
  suspense: "Suspense", aventura: "Aventura", biografia: "Biografia", filosofia: "Filosofia",
  religiao: "Religião", negocios: "Negócios", tecnologia: "Tecnologia", hqs: "HQs", hq: "HQs",
  mangas: "Mangás", manga: "Mangás",
};

export function foldPersonalGenre(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("pt-BR").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function resolvePersonalDriveGenre(folderName: string): string {
  const clean = folderName.trim() || "Sem gênero";
  return aliases[foldPersonalGenre(clean)] ?? clean;
}
