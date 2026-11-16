// Scan the working directory for TODO and FIXME markers.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { ensureTool } from "../utils/tools-manager.ts";
import { truncateLine } from "./tools/truncate.ts";

export interface TodoItem {
	path: string;
	line: number;
	tag: "TODO" | "FIXME";
	text: string;
}

export interface TodoScanResult {
	items: TodoItem[];
	total: number;
}

interface RgText {
	text?: string;
	bytes?: string;
}

interface RgEvent {
	type: string;
	data?: {
		path?: RgText;
		lines?: RgText;
		line_number?: number;
		submatches?: { match: RgText }[];
	};
}

function decodeRgText(value: RgText | undefined): string {
	if (value?.text !== undefined) return value.text;
	if (value?.bytes !== undefined) return Buffer.from(value.bytes, "base64").toString("utf8");
	return "";
}

/** Find matching lines in the working directory, retaining at most limit items. */
export async function scanTodos(cwd: string, limit = 500): Promise<TodoScanResult> {
	const rgPath = await ensureTool("rg");
	if (!rgPath) throw new Error("ripgrep (rg) is not available and could not be downloaded");

	return new Promise((resolve, reject) => {
		const child = spawn(
			rgPath,
			[
				"--no-config",
				"--json",
				"--line-number",
				"--color=never",
				"--hidden",
				"--glob",
				"!.git",
				"-e",
				"\\b(TODO|FIXME)\\b",
				"--",
				".",
			],
			{ cwd, stdio: ["ignore", "pipe", "pipe"] },
		);
		const lines = createInterface({ input: child.stdout });
		const items: TodoItem[] = [];
		let total = 0;
		let stderr = "";

		lines.on("line", (line) => {
			let event: RgEvent;
			try {
				event = JSON.parse(line) as RgEvent;
			} catch {
				return;
			}
			if (event.type !== "match" || !event.data) return;
			const filePath = decodeRgText(event.data.path);
			const lineNumber = event.data.line_number;
			const tag = decodeRgText(event.data.submatches?.[0]?.match);
			if (!filePath || typeof lineNumber !== "number" || (tag !== "TODO" && tag !== "FIXME")) return;
			total++;
			if (items.length < limit) {
				items.push({
					path: filePath.replace(/^\.\//, "").replace(/\\/g, "/"),
					line: lineNumber,
					tag,
					text: truncateLine(decodeRgText(event.data.lines).trim()).text,
				});
			}
		});
		child.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});
		child.on("error", (error) => reject(new Error(`Failed to run ripgrep: ${error.message}`)));
		child.on("close", (code) => {
			lines.close();
			if (code !== 0 && code !== 1) {
				reject(new Error(stderr.trim() || `ripgrep exited with code ${code}`));
			} else {
				resolve({ items, total });
			}
		});
	});
}
