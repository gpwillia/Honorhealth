import { PrismaClient } from "@prisma/client";
import { existsSync } from "node:fs";
import path from "node:path";

function resolveDefaultDatabaseUrl(): string {
	const candidates = [
		{ relativePath: "prisma/dev.db", url: "file:./prisma/dev.db" },
		{ relativePath: "apps/api/prisma/dev.db", url: "file:./apps/api/prisma/dev.db" }
	];

	for (const candidate of candidates) {
		if (existsSync(path.resolve(process.cwd(), candidate.relativePath))) {
			return candidate.url;
		}
	}

	return "file:./prisma/dev.db";
}

if (!process.env.DATABASE_URL) {
	process.env.DATABASE_URL = resolveDefaultDatabaseUrl();
}

export const prisma = new PrismaClient();
