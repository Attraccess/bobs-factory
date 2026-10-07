// biome-ignore-all lint/a11y/noNoninteractiveTabindex: scrollable diffs need keyboard focus
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { Guide, GuideChapter } from "../FactoryResults";
import type { ReviewFile, ReviewFilesManifest } from "../ReviewFiles";
import { api } from "./client";
import {
	areaColor,
	areaName,
	chapterColor,
	type FileTree,
	fileArea,
	fileTotals,
	fileTree,
	groupReviewFiles,
	isTestFile,
	parsePatch,
	splitPatch,
	treeFiles,
} from "./review-model";
import { signature } from "./review-state";
import { Button, External, Modal } from "./ui";
export function FileLink({
	path,
	url,
	children,
}: {
	path: string;
	url?: string;
	children?: React.ReactNode;
}) {
	const [anchor, setAnchor] = useState<string>();
	useEffect(() => {
		let current = true;
		void crypto.subtle
			.digest("SHA-256", new TextEncoder().encode(path))
			.then((bytes) => {
				if (current)
					setAnchor(
						[...new Uint8Array(bytes)]
							.map((n) => n.toString(16).padStart(2, "0"))
							.join(""),
					);
			})
			.catch(() => {});
		return () => {
			current = false;
		};
	}, [path]);
	return url ? (
		<External href={`${url}/files${anchor ? `#diff-${anchor}` : ""}`}>
			{children ?? path} ↗
		</External>
	) : (
		<code>{children ?? path}</code>
	);
}
export function useReviewFiles(run: any, guide: Guide) {
	return useQuery({
		queryKey: ["review-files", run.id, signature(guide)],
		queryFn: async ({ signal }) => {
			const bytes = await crypto.subtle.digest(
					"SHA-256",
					new TextEncoder().encode(JSON.stringify(guide)),
				),
				guideHash = [...new Uint8Array(bytes)]
					.map((n) => n.toString(16).padStart(2, "0"))
					.join("");
			const manifest = (await api(
				`/api/runs/${encodeURIComponent(run.id)}/review-files?guide=${guideHash}`,
				{ signal },
			)) as ReviewFilesManifest;
			return { manifest, guideHash };
		},
		staleTime: Infinity,
		retry: false,
	});
}
function Counts({ files }: { files: ReviewFile[] }) {
	const totals = fileTotals(files);
	return (
		<span className="file-counts">
			<span className="added">+{totals.additions ?? "?"}</span>{" "}
			<span className="removed">−{totals.deletions ?? "?"}</span>
		</span>
	);
}
function Tree({
	nodes,
	owners,
	owner,
	onOpen,
}: {
	nodes: FileTree[];
	owners: Map<string, number[]>;
	owner: number;
	onOpen: (file: ReviewFile) => void;
}) {
	return (
		<ul className="review-file-tree">
			{nodes.map((node) => (
				<li key={node.name}>
					{node.file && (
						<button
							type="button"
							className="file-row"
							onClick={() => onOpen(node.file!)}
						>
							<span
								role="img"
								className={`file-status status-${node.file.status}`}
								aria-label={
									{ A: "Added", M: "Modified", D: "Deleted", R: "Renamed" }[
										node.file.status
									]
								}
							>
								{node.file.status}
							</span>
							<span className="file-name">
								<strong>{node.name}</strong>
								<span className="file-tags">
									{isTestFile(node.file.path) && (
										<span className="chip">TEST</span>
									)}
									{owners
										.get(node.file.id)
										?.filter((i) => i !== owner)
										.map((i) => (
											<span
												key={i}
												className="chip shared-step"
												style={{ borderColor: chapterColor(i) }}
											>
												also step {i + 1}
											</span>
										))}
									{node.file.oldPath && (
										<span className="muted">from {node.file.oldPath}</span>
									)}
								</span>
							</span>
							<Counts files={[node.file]} />
							{node.file.additions !== null && node.file.deletions !== null && (
								<span className="ratio-bar" aria-hidden="true">
									<i
										style={{
											width: `${(100 * node.file.additions) / Math.max(1, node.file.additions + node.file.deletions)}%`,
										}}
									/>
								</span>
							)}
						</button>
					)}
					{node.children.length > 0 && (
						<details open>
							<summary className="folder-row">
								<strong>{node.name}/</strong>
								<span className="count-pill">
									{node.files.length - (node.file ? 1 : 0)}{" "}
									{node.files.length - (node.file ? 1 : 0) === 1
										? "file"
										: "files"}
								</span>
								<span className="folder-counts">
									<Counts
										files={node.files.filter((file) => file !== node.file)}
									/>
								</span>
							</summary>
							<Tree
								nodes={node.children}
								owners={owners}
								owner={owner}
								onOpen={onOpen}
							/>
						</details>
					)}
				</li>
			))}
		</ul>
	);
}
function DiffBody({ patch, split }: { patch: string; split: boolean }) {
	const [limit, setLimit] = useState(500);
	const lines = parsePatch(patch),
		paired = splitPatch(lines),
		isSplit = split,
		rows = isSplit ? paired : lines;
	return (
		<>
			{!lines.length && (
				<p role="status">No text hunks. This file has metadata changes only.</p>
			)}
			<section
				className={`diff-body ${isSplit ? "split" : "unified"}`}
				tabIndex={0}
				aria-label={`${isSplit ? "Split" : "Unified"} file diff`}
			>
				{isSplit
					? paired.slice(0, limit).map((row, i) =>
							row.kind === "hunk" || row.kind === "meta" ? (
								<div className={`diff-line ${row.kind}`} key={i}>
									<code>{row.left?.text}</code>
								</div>
							) : (
								<div className="split-row" key={i}>
									{[row.left, row.right].map((line, j) => (
										<div
											key={j}
											className={`diff-line ${line?.kind ?? "empty"}`}
										>
											<span className="gutter">
												{j === 0 ? line?.old : line?.next}
											</span>
											<span className="diff-sign">
												{line?.kind === "remove"
													? "−"
													: line?.kind === "add"
														? "+"
														: " "}
											</span>
											<code>
												{line?.text ?? ""}
												{line?.note && (
													<>
														<br />
														<em>{line.note}</em>
													</>
												)}
											</code>
										</div>
									))}
								</div>
							),
						)
					: lines.slice(0, limit).map((line, i) => (
							<div key={i} className={`diff-line ${line.kind}`}>
								{!["hunk", "meta"].includes(line.kind) && (
									<>
										<span className="gutter">{line.old}</span>
										<span className="gutter">{line.next}</span>
										<span className="diff-sign">
											{line.kind === "remove"
												? "−"
												: line.kind === "add"
													? "+"
													: " "}
										</span>
									</>
								)}
								<code>{line.text}</code>
							</div>
						))}
			</section>
			{rows.length > limit && (
				<Button variant="secondary" onClick={() => setLimit(rows.length)}>
					Show remaining {rows.length - limit} lines
				</Button>
			)}
		</>
	);
}
function DiffFile({
	file,
	manifest,
	guideHash,
	runId,
	split,
}: {
	split: boolean;
	file: ReviewFile;
	manifest: ReviewFilesManifest;
	guideHash: string;
	runId: string;
}) {
	const query = useQuery({
		queryKey: ["review-patch", runId, manifest.snapshotId, file.id, guideHash],
		queryFn: ({ signal }) =>
			api(
				`/api/runs/${encodeURIComponent(runId)}/review-files/${manifest.snapshotId}/${file.id}?guide=${guideHash}`,
				{ signal },
			),
		staleTime: Infinity,
		retry: false,
	});
	return (
		<>
			<p className="muted diff-metadata">
				{file.oldPath && <> · Renamed from {file.oldPath}</>}
				{file.oldMode !== file.newMode && (
					<>
						{" "}
						· Mode {file.oldMode} → {file.newMode}
					</>
				)}
				{file.submodule && " · Submodule"}
			</p>
			{query.isPending ? (
				<p role="status">Loading this file’s diff…</p>
			) : query.error ? (
				<div role="alert">
					<p>Could not load this diff: {query.error.message}</p>
					<Button variant="secondary" onClick={() => void query.refetch()}>
						Retry file
					</Button>
				</div>
			) : query.data?.patch ? (
				<DiffBody patch={query.data.patch} split={split} />
			) : (
				<p role="status">
					{query.data?.reason ??
						"No text changes. This file has metadata changes only."}
				</p>
			)}
		</>
	);
}
export function ChangedFiles({
	query,
	chapters,
	run,
	onChapter,
	reviewed = {},
}: {
	reviewed?: Record<string, boolean>;
	query: ReturnType<typeof useReviewFiles>;
	chapters: GuideChapter[];
	run: any;
	onChapter: (i: number) => void;
}) {
	const [split, setSplit] = useState(true),
		[narrow, setNarrow] = useState(
			() => matchMedia("(max-width: 650px)").matches,
		);
	useEffect(() => {
		const media = matchMedia("(max-width: 650px)"),
			change = () => setNarrow(media.matches);
		media.addEventListener("change", change);
		return () => media.removeEventListener("change", change);
	}, []);
	const [viewer, setViewer] = useState<{
			files: ReviewFile[];
			index: number;
		}>(),
		manifest = query.data?.manifest,
		url = run.reviewGate?.url ?? run.outputs["draft-pr"]?.url;
	if (!manifest)
		return (
			<section>
				<p role={query.error ? "alert" : "status"}>
					{query.error
						? `Changed files are unavailable: ${query.error.message}`
						: "Loading the reviewed file inventory…"}
				</p>
				{query.error && (
					<Button variant="secondary" onClick={() => void query.refetch()}>
						Retry files
					</Button>
				)}
				<External href={url ? `${url}/files` : undefined}>
					Open PR diff ↗
				</External>
			</section>
		);
	const grouped = groupReviewFiles(manifest.files, chapters),
		totals = fileTotals(manifest.files),
		file = viewer?.files[viewer.index];
	const group = (files: ReviewFile[], owner: number) => {
		const chapter = chapters[owner],
			nodes = fileTree(files),
			order = treeFiles(nodes),
			areas = [...new Set(files.map((f) => fileArea(f.path)))],
			exclusive = areas.filter(
				(a) =>
					grouped.areaOwners.get(a)?.size === 1 &&
					grouped.areaOwners.get(a)?.has(owner),
			);
		return (
			<details
				key={owner}
				className={`file-group ${owner < 0 ? "unassigned" : ""}`}
				open={owner < 0 ? true : undefined}
				style={
					{
						"--chapter": owner < 0 ? "var(--stuck-text)" : chapterColor(owner),
					} as React.CSSProperties
				}
			>
				<summary>
					<span className="step-badge">
						{owner < 0 ? "!" : reviewed[chapter!.id] ? "✓" : owner + 1}
					</span>
					<span className="group-title">
						<strong>{chapter?.title ?? "Not explained by any step"}</strong>
						<span>
							<span className="count-pill">
								{files.length} {files.length === 1 ? "file" : "files"}
							</span>{" "}
							· <Counts files={files} />
							{exclusive.length > 0 && (
								<span className="exclusive">
									{" "}
									· {exclusive.length} area{exclusive.length > 1 ? "s" : ""}{" "}
									only this step touches
								</span>
							)}
						</span>
					</span>
					<span
						role="img"
						className="area-bar"
						aria-label={`Areas: ${areas.map(areaName).join(", ")}`}
					>
						{areas.map((area) => (
							<i
								key={area}
								style={{
									background: areaColor(area),
									flex: files.filter((f) => fileArea(f.path) === area).length,
								}}
							/>
						))}
					</span>
				</summary>
				<div className="file-group-content">
					<div className="area-chips">
						{areas.map((area) => (
							<span
								className={`chip ${exclusive.includes(area) ? "exclusive-area" : ""}`}
								aria-description={
									exclusive.includes(area)
										? "No other step touches this area."
										: undefined
								}
								key={area}
								title={
									exclusive.includes(area)
										? "No other step touches this area"
										: undefined
								}
							>
								<i
									className="area-swatch"
									aria-hidden="true"
									style={{ background: areaColor(area) }}
								/>
								{areaName(area)} ·{" "}
								{files.filter((f) => fileArea(f.path) === area).length}
								{exclusive.includes(area) && (
									<span
										className="exclusive"
										title="No other step touches this area"
									>
										{" "}
										· ONLY THIS STEP
									</span>
								)}
							</span>
						))}
					</div>
					{exclusive.length > 0 && (
						<small className="muted">
							No other step touches these exclusive areas.
						</small>
					)}
					{chapter && (
						<button
							type="button"
							className="text-button"
							onClick={() => onChapter(owner + 1)}
						>
							← Back to step {owner + 1}
						</button>
					)}
					<Tree
						nodes={nodes}
						owners={grouped.owners}
						owner={owner}
						onOpen={(f) =>
							setViewer({
								files: order,
								index: order.findIndex((item) => item.id === f.id),
							})
						}
					/>
				</div>
			</details>
		);
	};
	const move = (delta: number) =>
		setViewer((v) =>
			v
				? {
						...v,
						index: Math.max(0, Math.min(v.files.length - 1, v.index + delta)),
					}
				: v,
		);
	return (
		<>
			<div className="guide-facts">
				<span className="chip">
					{totals.files} {totals.files === 1 ? "file" : "files"}
				</span>
				<span className="chip">
					<Counts files={manifest.files} />
				</span>
				<span className="chip">{totals.tests} tests</span>
				<span className={`chip ${grouped.unassigned.length ? "red" : "green"}`}>
					{grouped.unassigned.length
						? `⚠ ${grouped.unassigned.length} not explained by any step`
						: "✓ every file belongs to a step"}
				</span>
			</div>
			{grouped.unassigned.length > 0 && group(grouped.unassigned, -1)}
			{grouped.groups.map((files, i) => group(files, i))}
			<Modal
				open={Boolean(viewer)}
				onOpenChange={(open) => {
					if (!open) setViewer(undefined);
				}}
				className="diff-viewer"
				title={
					file && (
						<>
							<span
								role="img"
								className={`file-status status-${file.status}`}
								aria-label={`File status ${file.status}`}
							>
								{file.status}
							</span>{" "}
							<span className="diff-path">
								<span className="muted">
									{file.path.slice(0, file.path.lastIndexOf("/") + 1)}
								</span>
								<strong>
									{file.path.slice(file.path.lastIndexOf("/") + 1)}
								</strong>
							</span>{" "}
							<Counts files={[file]} />
						</>
					)
				}
				description={`Reviewed ${manifest.baseSha.slice(0, 8)} → ${manifest.headSha.slice(0, 8)} · Esc to close`}
				headerControls={
					viewer &&
					file && (
						<div className="diff-toolbar">
							{!narrow && (
								<fieldset className="diff-mode" aria-label="Diff format">
									<Button
										variant="secondary"
										aria-pressed={!split}
										onClick={() => setSplit(false)}
									>
										Unified
									</Button>
									<Button
										variant="secondary"
										aria-pressed={split}
										onClick={() => setSplit(true)}
									>
										Split
									</Button>
								</fieldset>
							)}
							<Button
								variant="secondary"
								aria-label="Previous file"
								disabled={viewer.index === 0}
								onClick={() => move(-1)}
							>
								←
							</Button>
							<span>
								{viewer.index + 1}/{viewer.files.length}
							</span>
							<Button
								variant="secondary"
								aria-label="Next file"
								disabled={viewer.index === viewer.files.length - 1}
								onClick={() => move(1)}
							>
								→
							</Button>
							<FileLink path={file.path} url={url}>
								PR file
							</FileLink>
						</div>
					)
				}
				onKeyDown={(e: React.KeyboardEvent) => {
					if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
						e.preventDefault();
						e.stopPropagation();
						move(e.key === "ArrowLeft" ? -1 : 1);
					}
				}}
			>
				{viewer && file && (
					<DiffFile
						key={`${manifest.snapshotId}/${file.id}`}
						file={file}
						manifest={manifest}
						guideHash={query.data!.guideHash}
						runId={run.id}
						split={split && !narrow}
					/>
				)}
			</Modal>
		</>
	);
}
