import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "MOODLE_");
  return {
    // O token NUNCA é injetado na página. O servidor só escuta nesta máquina (127.0.0.1);
    // o login é feito pela tela e o token fica só no navegador.
    // O MOODLE_TOKEN do .env é usado apenas pelos scripts de terminal.
    define: {
      __MOODLE_URL__: JSON.stringify(env.MOODLE_URL || "https://avagrad.unievangelica.edu.br"),
    },
    server: {
      host: "127.0.0.1",
      port: 5173,
      strictPort: true,
      fs: {
        // Além do padrão (.env, certificados, .git), não servir o cache dos scripts (tem notas e perfil).
        deny: [".env", ".env.*", "*.{crt,pem}", "**/.git/**", "**/.cache/**"],
      },
    },
  };
});
