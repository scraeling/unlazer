# Unlazer

Export your osu!lazer beatmap library back to osu!(stable).

## Requirements

- Install [deno](https://deno.land/)

        iwr https://deno.land/x/install/install.ps1 -useb | iex

## Usage

- Run

        deno run --unstable --allow-read --allow-write --allow-env --allow-run --allow-net https://raw.githubusercontent.com/scraeling/unlazer/master/app.ts

- Follow the instructions

## Notes

- This is for Windows only.

- Copying may fail due to Windows' path length limit. Enable [long paths.](https://docs.microsoft.com/en-us/windows/win32/fileio/maximum-file-path-limitation?tabs=cmd#enable-long-paths-in-windows-10-version-1607-and-later)

- If beatmaps were copied successfully but don't show up ingame, try deleting `/osu!/osu!.db` and rescanning.