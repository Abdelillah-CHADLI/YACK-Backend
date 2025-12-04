import fs from "fs/promises";
import path from "path";

const MEDIA_ROOT = path.join(process.cwd(), "uploads");

export class MediaHandler {

    static async send(media) {
        if (!media || !media.buffer || !media.filename) {
            throw new Error("Invalid media payload");
        }

        await fs.mkdir(MEDIA_ROOT, { recursive: true });
        const filePath = path.join(MEDIA_ROOT, media.filename);
        await fs.writeFile(filePath, media.buffer);
        return { path: filePath };
    }

    static async get(mediaPath) {
        if (!mediaPath) {
            throw new Error("Media path required");
        }

        const file = await fs.readFile(mediaPath);
        return file;
    }
}