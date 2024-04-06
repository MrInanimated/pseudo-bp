import fs from "fs";
import * as esbuild from "esbuild";
import { sassPlugin } from "esbuild-sass-plugin";

let fullBuild = true;
if (process.argv.includes("--quick")) {
    fullBuild = false;
}

console.log("Build script start")
console.log("===============================");

if (fullBuild) {
    console.log("Copying public JS assets...")
    fs.cpSync("assets/js", "build/public/js", { recursive: true })

    console.log("Copying public sound assets...")
    fs.cpSync("assets/sounds", "build/public/sounds", { recursive: true })

    console.log("Copying public image assets...")
    fs.cpSync("assets/images", "build/public/images", { recursive: true })

    console.log("Copying public JS lib assets...")
    fs.cpSync("assets/lib", "build/public/lib", { recursive: true })

    console.log("Copying backend assets...")
    fs.cpSync("src", "build", {
        recursive: true,
        filter: (source, _destination) => !source.endsWith(".js") && !source.endsWith(".ts"),
    });
}

console.log("Building SASS/CSS...")
await esbuild.build({
    entryPoints: ["assets/css/**/*.scss"],
    outdir: "build/public/css",
    plugins: [sassPlugin()],
});

console.log("Building backend JS/TS...")
await esbuild.build({
    entryPoints: ["src/**/*.js", "src/**/*.ts"],
    tsconfig: "tsconfig.json",
    format: 'cjs',
    platform: "node",
    target: "node16.20",
    outdir: "build",
});

console.log("===============================");
console.log("Build script complete.")
