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

const appdata = Deno.env.get("APPDATA") as string;
const localappdata = Deno.env.get("LOCALAPPDATA") as string;

await log.setup({
    handlers: {
        file: new log.handlers.FileHandler("DEBUG", {
            filename: path.join(appdata, "osu", "unlazer.log"),
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

function rowCount(db: DB, tableName: string): number {
    logger.debug(`Getting row count for ${tableName}`);
    const count = db.query(`SELECT COUNT(*) FROM ${tableName}`);
    if (!count) {
        logger.error(`Could not find database table: ${tableName}`);
    }
    return count[0][0] as number;
}

/**
 * 	hash: `9d1ab9ad1c...`
 * 	path:`/9/9d/{hash}` */
function hashToFilePath(hash: string): string {
    return path.join(hash[0], hash.substring(0, 2), hash);
}

function getFilePaths(db: DB, lazerFiles: string, stableFiles: string) {
    /*
   ┌───────────────────┐
   │BeatmapSetFileInfo │                        ┌────────────────┐
   │|-ID               │                        │BeatmapMetadata │
   │|-BeatmapSetInfoID─┼─┐                 ┌────┤|-ID            │
 ┌─┤|-FileInfoID       │ │   ┌───────────┐ │    │|-Artist        │
 │ │|-Filename         │ │   │FileInfo   │ │    │|-Author        │
 │ └───────────────────┘ │ ┌─┤|-ID       │ │    │|-Title         │
 │                       │ │ │|-Hash     │ │    └────────────────┘
 └───────────────────-──>┼>┘ └───────────┘ │
                         │                 └────────────────────┐
                         │             ┌─────────────────────┐  │
   ┌───────────────────┐ │             │BeatmapSetInfo       │  │
   │ BeatmapInfo       │ │             │|-MetadataID ────────┼──┘
   │ |-ID              │ ├>────────────┤|-ID                 │
   │ |-BeatmapSetInfoID├─┘             │|-OnlineBeatmapSetID │
   └───────────────────┘               └─────────────────────┘
    */

    const nc = (x: any) => x == null ? "" : x; // null check

    // Get the data we need to generate a folder name for each BeatmapSet
    const folderQuery = db.query(`
        SELECT BeatmapSetInfo.ID, OnlineBeatmapSetID, Artist, Author, Title
        FROM BeatmapSetInfo
        INNER JOIN BeatmapMetadata ON BeatmapMetadata.ID = BeatmapSetInfo.MetadataID
        GROUP BY BeatmapSetInfo.ID
    `);
    let folderNames: { [id: number]: string } = {};
    for (const [ID, onlineID, artist, author, title] of folderQuery) {
        folderNames[ID as number] = path.normalize(`${nc(onlineID)} ${nc(artist)} - ${
            nc(title)
        } [${nc(author)}]`.trim());
    }

    // Get filenames and hashes, and generate final paths
    const fileQuery = db.query(`
        SELECT BeatmapSetInfoID, Filename, Hash
        FROM BeatmapSetFileInfo
        INNER JOIN FileInfo ON FileInfo.ID = BeatmapSetFileInfo.FileInfoID
    `);
    let paths = new Array<[string, string]>();
    for (const [ID, filename, hash] of fileQuery) {
        const src: string = path.join(
            lazerFiles,
            hashToFilePath(hash as string),
        );
        const dest: string = path.join(
            stableFiles,
            folderNames[ID as number],
            filename as string,
        );
        paths.push([src, dest]);
    }
    return paths;
}

function copyFile(src: string, dest: string) {
    try {
        fs.ensureDirSync(path.dirname(dest));
        fs.copySync(src, dest);
    } catch (error) {
        logger.debug(error);
    }
}

async function linkFile(src: string, dest: string) {
    try {
        await fs.ensureSymlink(src, dest);
    } catch (error) {
        logger.debug(error);
    }
}

// FIXME: Workaround until https://github.com/dyedgreen/deno-sqlite/issues/149 is resolved
async function setJournalMode(dbPath: string, mode: string) {
    const db = await connect(dbPath);
    logger.debug(`Setting journal_mode to ${mode}`);
    await db.execute(`PRAGMA journal_mode = '${mode}'`);
    await db.close();
}

async function main() {
    logger.debug("Starting");
    console.clear();
    console.log("========== unlazer ==========\n\n");

    // Get lazer dir
    console.log(
        "Let's locate your osu directories. Press enter to use the defaults.\n\n",
    );
    const lazerDir = prompt(
        "Enter the path to the osu!lazer data directory:\n",
        path.join(appdata, "osu"),
    ) as string;
    logger.debug(`Setting lazer directory to: ${lazerDir}`);
    const lazerFiles = path.join(lazerDir, "files");
    const dbPath = path.join(lazerDir, "client.db");

    await setJournalMode(dbPath, "OFF");

    // Open and check database
    logger.debug(`Attempting to connect to: ${dbPath}`);
    const db = new DB(dbPath);
    logger.info(`Using ${dbPath}`);
    const count = {
        maps: rowCount(db, "BeatmapInfo"),
        sets: rowCount(db, "BeatmapSetInfo"),
        files: rowCount(db, "BeatmapSetFileInfo"),
    };
    logger.info(
        `This osu!lazer install has ${count.sets} mapsets with ${count.maps} beatmaps and ${count.files} files.`,
    );

    // Get stable dir
    const stableDir = prompt(
        "\n\nEnter the path to the osu!(stable) directory:\n",
        path.join(localappdata, "osu!"),
    ) as string;
    logger.debug(`Setting stable directory to: ${stableDir}`);
    const stableFiles = path.join(stableDir, "Songs");
    fs.ensureDirSync(stableFiles);

    // Set operating mode
    console.log("\n\nRun in copy or symlink mode?\n");
    console.log(
        "copy: Makes a copy of all files, uses more space, takes longer, but stable.\n",
    );
    console.log(
        "symlink: Links files to the osu!lazer library, faster, no duplication, but editing files may break stuff.\n",
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
        `\n\n${mode}ing ${count.files} files from ${lazerFiles} to ${stableFiles}\n`,
    );
    if (prompt("Continue?", "Yes")?.toLowerCase() != "yes") {
        logger.critical("Exiting");
        db.close();
        Deno.exit(1223);
    }

    // Set up progressbar
    const displayFormat = `${mode.toUpperCase()}ING (:completed/:total) [:bar] :percent`;
    const progress = new ProgressBar({
        total: count.files,
        complete: "=",
        incomplete: "-",
        display: displayFormat,
    });
    let completed = 0;
    console.log("\n\n\n");
    progress.render(completed);

    // Perform operations
    const paths = getFilePaths(db, lazerFiles, stableFiles);
    for (const [src, dest] of paths) {
        logger.debug(`${mode}ing ${src} to ${dest}`);
        await op(src, dest);
        completed += 1;
        if (completed % 128 == 0) {
            progress.render(completed);
        }
    }

    // Exit
    console.log("\n\n\n");
    logger.info(`Completed ${mode} operations successfully.`);
    console.log("\nStart osu! and hit F5 to scan for the beatmaps.\n\n");
    logger.debug("Closing database and exiting");
    db.close();
    await setJournalMode(dbPath, "WAL");
}

await main();
