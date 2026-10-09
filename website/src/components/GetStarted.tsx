import {
	channelDownloads,
	channelInstallCommand,
	INSTALL_COMMAND,
	LAUNCH_COMMAND,
	REPO,
	release,
	releaseAvailable,
} from "../install";
import { Bob } from "./Bob";
import { CopyCommand } from "./CopyCommand";
import { Reveal, SectionTitle } from "./ui";

function InstallTerminal() {
	return (
		<div className="rounded-[26px] border border-white/10 bg-night p-6 font-mono text-[13px] leading-relaxed shadow-[0_40px_90px_-30px_#2b2346aa] sm:p-8 sm:text-sm">
			<div aria-hidden className="mb-7 flex gap-1.5">
				<span className="size-3 rounded-full bg-[#ff5d73]" />
				<span className="size-3 rounded-full bg-[#ffd23f]" />
				<span className="size-3 rounded-full bg-[#3ddc97]" />
			</div>
			<p className="mb-3 text-xs font-bold uppercase tracking-widest text-white/50">
				Install Bob
			</p>
			<pre className="whitespace-pre-wrap text-white [overflow-wrap:anywhere]">
				<code>{INSTALL_COMMAND}</code>
			</pre>
			<div className="mt-5 flex justify-end">
				<CopyCommand
					command={INSTALL_COMMAND}
					label="Copy install command"
					dark
					disabled={!releaseAvailable}
				/>
			</div>
			<div className="my-7 border-t border-white/10" />
			<p className="mb-3 text-xs font-bold uppercase tracking-widest text-white/50">
				Then launch Bob
			</p>
			<pre className="whitespace-pre-wrap text-white [overflow-wrap:anywhere]">
				<code>{LAUNCH_COMMAND}</code>
			</pre>
			<div className="mt-5 flex justify-end">
				<CopyCommand
					command={LAUNCH_COMMAND}
					label="Copy launch command"
					dark
				/>
			</div>
			<p className="mt-7 font-sans text-sm leading-relaxed text-white/60">
				Your browser opens. Bob walks you through the rest.
			</p>
		</div>
	);
}

export function GetStarted() {
	return (
		<section id="start" className="relative overflow-hidden py-28 sm:py-36">
			<div aria-hidden className="pointer-events-none absolute inset-0">
				<div className="absolute left-1/2 top-20 size-[44rem] -translate-x-1/2 rounded-full bg-[#ffd23f]/20 blur-[140px]" />
			</div>
			<div className="relative mx-auto grid max-w-6xl grid-cols-1 items-center gap-14 px-6 lg:grid-cols-2">
				<div className="min-w-0">
					<SectionTitle
						eyebrow="Get started"
						color="#08683f"
						title={
							<>
								Install Bob.
								<br />
								<span className="rainbow-text">He'll take it from here.</span>
							</>
						}
					>
						One install command for macOS and Linux. Bob brings his runtime,
						dashboard and workflows.
					</SectionTitle>
					<ol className="mt-8 space-y-6 text-base leading-relaxed text-ink-2">
						<li>
							<h3 className="font-bold text-ink">1. Install</h3>
							<p className="mt-1">
								Paste the install command into your terminal. Bob picks the
								right binary, checks the download and installs it for your user.
							</p>
						</li>
						<li>
							<h3 className="font-bold text-ink">2. Launch</h3>
							<p className="mt-1">
								Run the launch command in the same terminal. Your browser opens
								automatically. Create your passkey using the setup code Bob
								shows you.
							</p>
						</li>
						<li>
							<h3 className="font-bold text-ink">3. Make it yours</h3>
							<p className="mt-1">
								Choose your project and coding agent in the browser. Connect
								GitHub when you're ready to deliver PRs, then tell Bob what to
								build.
							</p>
						</li>
					</ol>
					<p className="mt-6 text-sm leading-relaxed text-ink-2">
						You'll need Git and a coding agent. Bob helps check what's ready. No
						GitHub CLI, Node or Bun is needed to install Bob.
					</p>
					{!releaseAvailable && (
						<p
							role="status"
							className="mt-6 rounded-2xl border border-[#ffd23f]/60 bg-[#fff8d9] p-4 text-sm leading-relaxed text-ink"
						>
							{release.message ?? "The first public release is being prepared."}{" "}
							The install command becomes available when downloads are ready.
						</p>
					)}
					{releaseAvailable && (
						<p className="mt-5 text-sm text-ink-2">
							{release.channel === "prerelease" ? "Preview" : "Version"}{" "}
							{release.version} · public download · no GitHub sign-in
						</p>
					)}
					<section
						className="mt-8 scroll-mt-24 space-y-4"
						aria-label="Stable and nightly downloads"
					>
						{channelDownloads.map((download) => (
							<article
								key={download.channel}
								className="rounded-2xl border border-line bg-white/70 p-5"
							>
								<h3 className="font-bold capitalize text-ink">
									{download.channel}
								</h3>
								{download.status === "available" ? (
									<>
										<p className="mt-2 text-sm text-ink-2">
											{download.version} · candidate{" "}
											<code className="break-all">{download.commit}</code>
										</p>
										<pre className="mt-3 whitespace-pre-wrap break-all text-xs">
											<code>{channelInstallCommand(download.channel!)}</code>
										</pre>
										<CopyCommand
											command={channelInstallCommand(download.channel!)}
											label={`Copy ${download.channel} install command`}
										/>
										<p className="mt-3 text-sm">Exact version:</p>
										<pre className="whitespace-pre-wrap break-all text-xs">
											<code>
												{channelInstallCommand(
													download.channel!,
													download.version,
												)}
											</code>
										</pre>
										<ul className="mt-3 flex flex-wrap gap-3 text-sm">
											{Object.entries(download.targets ?? {}).map(
												([target, asset]) => (
													<li key={target}>
														<a
															className="underline"
															href={`${REPO}/releases/download/${download.tag}/${asset.archive}`}
														>
															{target}
														</a>
													</li>
												),
											)}
											<li>
												<a
													className="underline"
													href={`${REPO}/releases/download/${download.tag}/release.json`}
												>
													Manifest and checksums
												</a>
											</li>
										</ul>
									</>
								) : (
									<p role="status" className="mt-2 text-sm text-ink-2">
										{download.message ??
											`No verified ${download.channel} release is available yet.`}
									</p>
								)}
							</article>
						))}
					</section>
					<Reveal delay={0.1} className="mt-8 flex flex-wrap gap-3">
						<a
							href={REPO}
							className="rounded-2xl bg-ink px-6 py-4 font-bold text-white shadow-[0_6px_0_#120c25] transition active:translate-y-1 active:shadow-[0_2px_0_#120c25]"
						>
							★ View on GitHub
						</a>
						<a
							href={`${REPO}/blob/main/docs/FACTORY.md`}
							className="rounded-2xl border border-line bg-white px-6 py-4 font-bold text-ink transition hover:-translate-y-0.5"
						>
							Read the factory docs
						</a>
					</Reveal>
				</div>
				<div className="relative min-w-0">
					<div className="absolute -right-2 -top-[92px] z-10">
						<Bob mood="happy" size={96} />
					</div>
					<InstallTerminal />
				</div>
			</div>
		</section>
	);
}

export function Footer() {
	return (
		<footer className="relative border-t border-line bg-white/50 py-16">
			<div className="mx-auto flex max-w-6xl flex-col items-center gap-6 px-6 text-center">
				<Bob mood="sleepy" size={72} track={false} />
				<p className="font-display text-2xl font-bold tracking-tight">
					Bob's off duty. Your PRs aren't.
				</p>
				<div className="flex flex-wrap justify-center gap-5 text-sm font-bold text-ink-2">
					<a href={REPO} className="hover:text-ink">
						GitHub
					</a>
					<a
						href={`${REPO}/blob/main/docs/FACTORY.md`}
						className="hover:text-ink"
					>
						Docs
					</a>
					<a
						href="https://github.com/cyrusagents/cyrus"
						className="hover:text-ink"
					>
						Built on Cyrus
					</a>
				</div>
				<p className="max-w-lg text-xs text-muted">
					Apache-2.0. Screens on this page are real Bob's Factory UI, running
					the actual factory runtime against a demo repository with scripted
					agents. No pancakes were harmed.
				</p>
			</div>
		</footer>
	);
}
