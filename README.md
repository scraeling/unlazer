unlazer
=======

Export your osu!lazer beatmap library back to osu!(stable).
Optionally you can choose to symlink to your lazer files to avoid duplication and play on both clients (just don't edit files).
Windows only for now.

## Requirements

- Install [deno](https://deno.land/)

        iwr https://deno.land/x/install/install.ps1 -useb | iex

## Usage

- Run

        deno run --unstable --allow-read --allow-write --allow-env --allow-run --allow-net https://raw.githubusercontent.com/scraeling/unlazer/master/app.ts

- Follow the instructions