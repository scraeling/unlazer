/*  unlazer
    Copyright (C) 2021 Scraeling

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/

import * as fs from "https://deno.land/std@0.107.0/fs/mod.ts";
import * as path from "https://deno.land/std@0.107.0/path/mod.ts";
import * as log from "https://deno.land/std@0.107.0/log/mod.ts";
import { DB } from "https://deno.land/x/sqlite@v3.1.1/mod.ts";
import { connect } from "https://deno.land/x/sqlite_shell@1.1.0/mod.ts";
import ProgressBar from "https://deno.land/x/progress@v1.2.3/mod.ts";

const logfile = path.join(Deno.env.get("TEMP") as string, "unlazer.log");
await log.setup({
    handlers: {
        file: new log.handlers.FileHandler("DEBUG", {
            filename: logfile,
            formatter: "[{datetime}] {msg}",
        }),
        console: new log.handlers.ConsoleHandler("INFO", {
            formatter: "{levelName}: {msg}",
        }),
    },
    loggers: {
        default: {
            level: "DEBUG",
            handlers: ["file", "console"],
        },
    },
});
const logger = log.getLogger();
logger.debug("Starting");

async function copyFile(src: string, dest: string) {
    try {
        fs.ensureDirSync(path.dirname(dest));
        fs.copySync(src, dest);
    } catch (error) {
        //FIXME: Jank error checking because fs doesn't have error types
        if (!(error as Error).message.endsWith("exists.")) {
            //FIXME: Jank safety net
            let p = Deno.run({
                cmd: ["cmd", "/C", "copy", "/Y", src, dest],
                stderr: "null",
                stdin: "null",
                stdout: "null",
            });
            if (!(await p.status()).success) {
                logger.debug(`Failed to copy\n${src}\n=> ${dest}`);
                logger.debug(error);
                return false;
            }
        }
    }
    return true;
}

async function linkFile(src: string, dest: string) {
    try {
        fs.ensureSymlinkSync(src, dest);
    } catch (error) {
        //FIXME: Jank safety net
        fs.ensureDirSync(path.dirname(dest));
        let cmd = Deno.run({
            cmd: ["cmd", "/C", "mklink", dest, src],
            stderr: "null",
            stdin: "null",
            stdout: "null",
        });
        if (!(await cmd.status()).success) {
            logger.debug(`Failed to link\n${src}\n=> ${dest}`);
            logger.debug(error);
            return false;
        }
    }
    return true;
}

async function main() {
    console.clear();
    console.log("========== unlazer ==========");

    // Get lazer dir
    console.log(
        "Let's locate your osu directories. Press enter to use the defaults.",
    );
    const lazerDir = prompt(
        "Enter the path to the osu!lazer data directory:\n",
        path.join(Deno.env.get("APPDATA") as string, "osu"),
    ) as string;
    logger.debug(`Setting lazer directory to: ${lazerDir}`);
    const lazerFiles = path.join(lazerDir, "files");
    const dbPath = path.join(lazerDir, "client.db");

    // FIXME: Workaround until sqlite can handle file locks (https://github.com/dyedgreen/deno-sqlite/issues/149)
    const setJournalMode = async (mode: string) => {
        const db = await connect(dbPath);
        logger.debug(`Setting journal_mode to ${mode}`);
        await db.execute(`PRAGMA journal_mode = '${mode}'`);
        await db.close();
    };
    await setJournalMode("OFF");

    // Open and check database
    logger.debug(`Opening database: ${dbPath}`);
    const db = new DB(dbPath);
    const getRowCount = (tableName: string) => {
        logger.debug(`Getting row count for ${tableName}`);
        const count = db.query(`SELECT COUNT(*) FROM ${tableName}`);
        return count[0][0] as number;
    };
    const count = {
        maps: getRowCount("BeatmapInfo"),
        sets: getRowCount("BeatmapSetInfo"),
        files: getRowCount("BeatmapSetFileInfo"),
    };
    logger.info(
        `This osu!lazer install has ${count.sets} mapsets with ${count.maps} beatmaps and ${count.files} files.`,
    );

    // Get stable dir
    const stableDir = prompt(
        "Enter the path to the osu!(stable) directory:",
        path.join(Deno.env.get("LOCALAPPDATA") as string, "osu!"),
    ) as string;
    logger.debug(`Setting osu! directory to: ${stableDir}`);
    const stableFiles = path.join(stableDir, "Songs");
    fs.ensureDirSync(stableFiles);

    // Set operating mode
    console.log("Run in copy or symlink mode?");
    console.log(
        "    copy: Makes a copy of all files, uses more space, takes longer, but good as old.",
    );
    console.log(
        "    symlink: Links files to the osu!lazer library, but editing files may break stuff.",
    );

    let op = copyFile;
    let mode = prompt("", "copy");
    if (mode != "copy") {
        mode = "symlink";
        op = linkFile;
    }
    logger.debug(`Running in ${mode} mode, set op to ${op.name}`);

    // Confirmation
    console.log(
        `${mode.toUpperCase()}ING ${count.files} files\n\tfrom ${lazerFiles}\n\tto ${stableFiles}`,
    );
    if (prompt("Continue?", "Yes")?.toLowerCase() != "yes") {
        logger.critical("User cancelled operation");
        db.close();
        setJournalMode("WAL");
        Deno.exit(1223);
    }

    // Initialize progress bar
    const displayFormat =
        `\t${mode.toUpperCase()}ING (:completed/:total) [:bar] :percent`;
    const progressBar = new ProgressBar({
        total: count.files,
        complete: "=",
        incomplete: "-",
        display: displayFormat,
    });
    progressBar.render(0);

    // Get the data we need to generate a folder name for each BeatmapSet
    const folderQuery = db.query(`
        SELECT BeatmapSetInfo.ID, OnlineBeatmapSetID, Artist, Author, Title
        FROM BeatmapSetInfo
        INNER JOIN BeatmapMetadata ON BeatmapMetadata.ID = BeatmapSetInfo.MetadataID
        GROUP BY BeatmapSetInfo.ID
    `);

    let folderNames: { [id: number]: string } = {};
    const nc = (x: any) => x == null ? "" : x;
    for (const [ID, onlineID, artist, author, title] of folderQuery) {
        folderNames[ID as number] = `${nc(onlineID)} ${nc(artist)} - ${
            nc(title)
        } [${nc(author)}]`
            .trim()
            .replace(/[<>:"/\\|?*]/g, "-");
    }

    // Get filenames and hashes, generate final paths, and perform op
    const fileQuery = db.query(`
        SELECT BeatmapSetInfoID, Filename, Hash
        FROM BeatmapSetFileInfo
        INNER JOIN FileInfo ON FileInfo.ID = BeatmapSetFileInfo.FileInfoID
    `);

    const hashToFile = (hash: string) =>
        path.join(hash[0], hash.substring(0, 2), hash);
    let progress = { completed: 0, errors: 0 };
    for (const [ID, filename, hash] of fileQuery) {
        const src: string = path.join(
            lazerFiles,
            hashToFile(hash as string),
        );
        const dest: string = path.join(
            stableFiles,
            folderNames[ID as number],
            (filename as string),
        );

        //logger.debug(`${mode}ing\n${src}\n =>${dest}`);
        const success = await op(src, dest);
        if (!success) {
            progress.errors += 1;
        }
        progress.completed += 1;
        if (progress.completed % 128 == 0) {
            progressBar.render(progress.completed);
        }
    }
    progressBar.render(progress.completed);

    // Finish
    if (progress.errors != 0) {
        logger.info(`Completed ${mode} operations.`);
        logger.warning(`There were ${progress.errors} errors.`);
        console.log(`Check ${logfile} for details.`);
    } else {
        logger.info(`Completed all ${mode} operations successfully.`);
    }
    console.log("Start osu! and hit F5 to scan for beatmaps.");

    db.close();
    await setJournalMode("WAL");
    logger.debug("Done");
}

await main();
