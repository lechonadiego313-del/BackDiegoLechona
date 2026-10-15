import { randomBytes } from "node:crypto";
import { appendFile, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";

const envPath = fileURLToPath(new URL("../.env", import.meta.url));
const source = await readFile(envPath, "utf8");
const environment = dotenv.parse(source);
const additions = [];

if (!environment.JWT_SECRET) {
  additions.push(`JWT_SECRET=${randomBytes(48).toString("base64url")}`);
}
if (!environment.CORS_ORIGIN) additions.push("CORS_ORIGIN=https://prueba-d-lechonaxdxd.vercel.app,http://localhost:5173,http://127.0.0.1:5173");
if (additions.length) await appendFile(envPath, `\n${additions.join("\n")}\n`, { encoding: "utf8", mode: 0o600 });

process.env.JWT_SECRET = environment.JWT_SECRET || additions.find((line) => line.startsWith("JWT_SECRET=")).slice("JWT_SECRET=".length);
process.env.CORS_ORIGIN = environment.CORS_ORIGIN || "https://prueba-d-lechonaxdxd.vercel.app,http://localhost:5173,http://127.0.0.1:5173";

const { sequelize, User } = await import("./database.js");
const initialAccounts = [
  { username: "super", name: "Super administrador", role: "super" },
  { username: "usuarios", name: "Administrador de usuarios", role: "user_admin" },
];
const generated = [];

try {
  await sequelize.authenticate();
  await sequelize.sync();

  for (const account of initialAccounts) {
    const existing = await User.findOne({ where: { username: account.username } });
    if (existing) {
      console.log(`La cuenta "${account.username}" ya existe; no se cambió su contraseña.`);
      continue;
    }
    const password = randomBytes(24).toString("base64url");
    const passwordHash = await bcrypt.hash(password, 12);
    await User.create({ ...account, passwordHash });
    generated.push({ ...account, password });
  }
} finally {
  await sequelize.close();
}

if (generated.length) {
  console.log("\nGuarda estas contraseñas ahora; solo se muestra una vez:\n");
  for (const account of generated) {
    console.log(`Usuario: ${account.username}`);
    console.log(`Nombre: ${account.name}`);
    console.log(`Rol: ${account.role}`);
    console.log(`Contraseña: ${account.password}\n`);
  }
} else {
  console.log("No se crearon cuentas nuevas. Las contraseñas existentes no se pueden recuperar.");
}
