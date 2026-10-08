import { useState } from "react";
import { Bob } from "./Bob";
import { CopyCommand } from "./CopyCommand";
import { Reveal, SectionTitle } from "./ui";

export const REPO = "https://github.com/jappyjan/bobs-factory";
export const LAUNCH_COMMAND =
	"bobs-factory --repo ~/code/my-project --agent codex";
const candidate = {
	version: "0.2.73",
	commit: "beb6ed76305946fcfab38fa978cb7e3b4e83f6dc",
	run: "37810552203",
};
const targets = [
	{ value: "darwin-arm64", label: "macOS · Apple Silicon" },
	{ value: "darwin-x64", label: "macOS · Intel" },
	{ value: "linux-x64", label: "Linux · x64 (glibc)" },
	{ value: "linux-arm64", label: "Linux · ARM64 (glibc)" },
];

function binarySetupCommands(target: string) {
	const name = `bobs-factory-${candidate.version}-${target}`;
	return `# Sign in to GitHub and your coding agent
gh auth login
codex login

# Download the verified ${target} preview
mkdir -p ~/Downloads/${name}
cd ~/Downloads/${name}
gh run download ${candidate.run} --repo jappyjan/bobs-factory \\
  --name bobs-factory-${target}-${candidate.commit}
gh api -H 'Accept: application/vnd.github.raw+json' \\
  'repos/jappyjan/bobs-factory/contents/scripts/install-binary.sh?ref=${candidate.commit}' \\
  > install-binary.sh

# Verify and install the binary
sh install-binary.sh ${name}.tar.gz ${name}.manifest.json ~/.local
export PATH="$HOME/.local/bin:$PATH"
bobs-factory --version

# Replace this path with your existing project
${LAUNCH_COMMAND}`;
}

const enrollmentCommand = "~/.local/bin/bobs-factory factory-auth";

const tools = [
	{ name: "Git", href: "https://git-scm.com/downloads" },
	{ name: "GitHub CLI", href: "https://cli.github.com/" },
	{ name: "Codex CLI", href: "https://developers.openai.com/codex/cli/" },
];

function Terminal({ target }: { target: string }) {
	const setupCommands = binarySetupCommands(target);
	return (
		<div className="rounded-[26px] border border-white/10 bg-night p-6 font-mono text-[13px] leading-relaxed shadow-[0_40px_90px_-30px_#2b2346aa] sm:text-sm">
			<div aria-hidden className="mb-5 flex gap-1.5">
				<span className="size-3 rounded-full bg-[#ff5d73]" />
				<span className="size-3 rounded-full bg-[#ffd23f]" />
				<span className="size-3 rounded-full bg-[#3ddc97]" />
			</div>
			<pre className="whitespace-pre-wrap text-white [overflow-wrap:anywhere]">
				<code>{setupCommands}</code>
			</pre>
			<div className="mt-6 flex justify-end">
				<CopyCommand command={setupCommands} label="Copy setup commands" dark />
			</div>
		</div>
	);
}

export function GetStarted() {
	const [target, setTarget] = useState(targets[0].value);
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
								From your laptop to{" "}
								<span className="rainbow-text">your first PR.</span>
							</>
						}
					>
						Install a verified preview binary for macOS or Linux. Bob bundles
						its runtime, dashboard and workflows.
					</SectionTitle>
					<ol className="mt-8 space-y-6 text-base leading-relaxed text-ink-2">
						<li>
							<h3 className="font-bold text-ink">1. Prepare your tools</h3>
							<p className="mt-1">
								Install{" "}
								{tools.map((tool, index) => (
									<span key={tool.name}>
										{index > 0 && (index === tools.length - 1 ? " and " : ", ")}
										<a
											href={tool.href}
											className="underline underline-offset-4"
										>
											{tool.name}
										</a>
									</span>
								))}
								. Authenticate your tools using their supported setup. The
								example uses Codex; select another prepared agent with{" "}
								<code>--agent</code>. An agent's own launcher may have
								additional prerequisites.
							</p>
						</li>
						<li>
							<h3 className="font-bold text-ink">
								2. Download, verify and start
							</h3>
							<p className="mt-1">
								Choose your platform and run the commands in order. The
								installer checks the archive and executable checksums. Add{" "}
								<code>~/.local/bin</code> to your shell's PATH for future
								terminals. Replace <code>~/code/my-project</code> with your
								project's existing Git checkout. It needs a checked-out branch
								and an <code>origin</code> you can push to. Leave Bob running in
								this terminal.
							</p>
							<p className="mt-2 text-sm">
								Preview {candidate.version} comes from a{" "}
								<a
									href={`${REPO}/actions/runs/${candidate.run}`}
									className="underline underline-offset-4"
								>
									successful native build
								</a>
								. Downloads require GitHub sign-in. Stable releases are pending
								publication.
							</p>
						</li>
						<li>
							<h3 className="font-bold text-ink">
								3. Open and unlock the dashboard
							</h3>
							<p className="mt-1">
								Open{" "}
								<a
									href="http://localhost:3457"
									className="underline underline-offset-4"
								>
									localhost:3457
								</a>
								. Generate a setup code in a second terminal, enter it in the
								setup screen and create your passkey. Then select a workflow and
								tell Bob what to build.
							</p>
						</li>
					</ol>
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
					<fieldset className="mb-4 grid grid-cols-2 gap-2">
						<legend className="sr-only">Binary platform</legend>
						{targets.map((option) => (
							<button
								key={option.value}
								type="button"
								aria-pressed={target === option.value}
								onClick={() => setTarget(option.value)}
								className={`rounded-xl border px-3 py-3 text-sm font-bold transition ${target === option.value ? "border-ink bg-ink text-white" : "border-line bg-white/80 text-ink hover:border-ink"}`}
							>
								{option.label}
							</button>
						))}
					</fieldset>
					<Terminal target={target} />
					<div className="mt-6 rounded-2xl border border-line bg-white/70 p-5">
						<h3 className="mb-3 font-bold text-ink">In a second terminal</h3>
						<p className="mb-3 text-sm leading-relaxed text-ink-2">
							While Bob is running, generate a single-use passkey setup code:
						</p>
						<CopyCommand command={enrollmentCommand} />
						<p className="mt-3 text-sm leading-relaxed text-ink-2">
							Keep the code private. It expires in ten minutes. See{" "}
							<a
								href={`${REPO}/blob/main/docs/FACTORY.md#passkey-access-and-first-setup`}
								className="underline underline-offset-4"
							>
								passkey setup and recovery
							</a>
							.
						</p>
					</div>
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
