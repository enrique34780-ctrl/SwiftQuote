import { copyFile, mkdir, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.dirname(rootDir);
const publicDir = path.join(projectDir, "public");

const frontendFiles = [
  "index.html",
  "app.js",
  "styles.css",
];

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function syncFrontend() {
  await mkdir(publicDir, { recursive: true });

  for (const fileName of frontendFiles) {
    const sourcePath = path.join(projectDir, fileName);
    const destinationPath = path.join(publicDir, fileName);

    if (!(await fileExists(sourcePath))) {
      console.log(
        `Skipping ${fileName}: root-level source file not found.`
      );
      continue;
    }

    await copyFile(sourcePath, destinationPath);
    console.log(`Synced ${fileName} to public/${fileName}`);
  }

  if (!(await fileExists(path.join(publicDir, "index.html")))) {
    throw new Error(
      "Frontend sync failed: public/index.html is missing. Add a valid index.html to the project root or public directory."
    );
  }

  console.log("Frontend sync completed successfully.");
}

syncFrontend().catch((error) => {
  console.error("Frontend sync failed:", error.message);
  process.exitCode = 1;
});
