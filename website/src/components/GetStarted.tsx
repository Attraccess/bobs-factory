import { useState } from "react";
import {
	channels,
	type InstallChannel,
	installCommand,
	LAUNCH_COMMAND,
	type PublicRelease,
	REPO,
} from "../install";
import { Bob } from "./Bob";
import { CopyCommand } from "./CopyCommand";
import { Reveal, SectionTitle } from "./ui";

function InstallTerminal({
	channel,
	selected,
}: {
	channel: InstallChannel;
	selected: PublicRelease;
}) {
	const command = installCommand(channel);
	const available = selected.status === "available";
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
				<code>{command}</code>
			</pre>
			<div className="mt-5 flex justify-end">
				<CopyCommand
					command={command}
					label="Copy install command"
					dark
					disabled={!available}
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
	const [channel, setChannel] = useState<InstallChannel>("stable");
	const selected = channels[channel];
	const available = selected.status === "available";
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
								right binary, verifies the publisher signature and download and
								installs it for your user.
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
						GitHub CLI, Node or Bun is needed to install Bob. Signature checks
						use your system’s OpenSSL.
					</p>
					<fieldset className="mt-6 flex gap-3" aria-label="Release channel">
						{(["stable", "nightly"] as const).map((choice) => (
							<button
								type="button"
								key={choice}
								aria-pressed={channel === choice}
								onClick={() => setChannel(choice)}
								className={`rounded-xl border px-5 py-3 font-bold ${channel === choice ? "border-ink bg-ink text-white" : "border-line bg-white text-ink"}`}
							>
								{choice === "stable" ? "Stable" : "Nightly"}
							</button>
						))}
					</fieldset>
					{channel === "nightly" && (
						<p className="mt-3 text-sm text-ink-2">
							Opt in to the newest verified prerelease. Nightly does not change
							the stable channel.
						</p>
					)}
					{!available && (
						<p
							role="status"
							className="mt-6 rounded-2xl border border-[#ffd23f]/60 bg-[#fff8d9] p-4 text-sm leading-relaxed text-ink"
						>
							{selected.message ??
								"No verified release is available for this channel."}{" "}
							The install command becomes available when downloads are ready.
						</p>
					)}
					{available && (
						<p className="mt-5 text-sm text-ink-2">
							{selected.channel === "beta" ||
							selected.version?.includes("-beta")
								? "Verified beta fallback"
								: channel === "nightly"
									? "Verified nightly"
									: "Verified stable"}{" "}
							{selected.version} · public download · no GitHub sign-in
						</p>
					)}
					{available && selected.targets && (
						<ul
							className="mt-4 flex flex-wrap gap-3 text-sm"
							aria-label="Native downloads"
						>
							{Object.entries(selected.targets).map(([target, entry]) => (
								<li key={target}>
									<a
										className="underline"
										href={`${REPO}/releases/download/${selected.tag}/${entry.archive}`}
									>
										{target}
									</a>
								</li>
							))}
						</ul>
					)}
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
					<InstallTerminal channel={channel} selected={selected} />
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
