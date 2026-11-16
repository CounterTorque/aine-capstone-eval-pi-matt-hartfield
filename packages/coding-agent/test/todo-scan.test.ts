import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scanTodos } from "../src/core/todo-scan.ts";

let cwd: string;

beforeEach(() => {
	cwd = mkdtempSync(join(tmpdir(), "pi-todos-"));
	mkdirSync(join(cwd, ".git"));
});

afterEach(() => rmSync(cwd, { recursive: true, force: true }));

describe("scanTodos", () => {
	it("finds whole-word markers in visible and hidden files, respecting gitignore", async () => {
		writeFileSync(join(cwd, ".gitignore"), "ignored.txt\n");
		writeFileSync(join(cwd, "ignored.txt"), "TODO ignored\n");
		writeFileSync(join(cwd, ".git", "config"), "TODO git internals\n");
		writeFileSync(join(cwd, "source.ts"), "first\n  // TODO: improve this\n// FIXME: repair\nTODOS autodo todo\n");
		writeFileSync(join(cwd, ".hidden"), "# TODO hidden file\n");

		const result = await scanTodos(cwd);
		expect(result.total).toBe(3);
		expect(result.items).toEqual(
			expect.arrayContaining([
				{ path: "source.ts", line: 2, tag: "TODO", text: "// TODO: improve this" },
				{ path: "source.ts", line: 3, tag: "FIXME", text: "// FIXME: repair" },
				{ path: ".hidden", line: 1, tag: "TODO", text: "# TODO hidden file" },
			]),
		);
	});

	it("returns an empty result when there are no matches", async () => {
		writeFileSync(join(cwd, "source.ts"), "TODOS autodo todo\n");
		expect(await scanTodos(cwd)).toEqual({ items: [], total: 0 });
	});

	it("limits retained items while counting all matching lines", async () => {
		writeFileSync(join(cwd, "source.ts"), "TODO first\nFIXME second\nTODO third\n");
		const result = await scanTodos(cwd, 2);
		expect(result.total).toBe(3);
		expect(result.items).toEqual([
			{ path: "source.ts", line: 1, tag: "TODO", text: "TODO first" },
			{ path: "source.ts", line: 2, tag: "FIXME", text: "FIXME second" },
		]);
	});

	it("reports ripgrep errors instead of returning an empty result", async () => {
		await expect(scanTodos(join(cwd, "missing"))).rejects.toThrow("Failed to run ripgrep");
	});
});
