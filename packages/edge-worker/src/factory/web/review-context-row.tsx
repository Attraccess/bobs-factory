import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { useEffect, useRef, useState } from "react";
import { type CheckoutCommand, reviewContext } from "./review-context";
import { Button, External, useToast } from "./ui";

function CopyIcon({ copied = false }: { copied?: boolean }) {
	return (
		<svg
			className="checkout-icon"
			width="16"
			height="16"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			aria-hidden="true"
		>
			{copied ? (
				<path d="m5 12 4 4L19 6" />
			) : (
				<>
					<rect x="8" y="8" width="12" height="12" rx="2" />
					<path d="M16 8V4H4v12h4" />
				</>
			)}
		</svg>
	);
}

export function ReviewContextRow({ run }: { run: unknown }) {
	const context = reviewContext(run),
		toast = useToast();
	const [manual, setManual] = useState<CheckoutCommand>();
	const [copied, setCopied] = useState<CheckoutCommand>();
	const text = useRef<HTMLTextAreaElement>(null);
	const manualFocus = useRef(false);
	useEffect(() => {
		if (!copied) return;
		const timer = setTimeout(() => setCopied(undefined), 2600);
		return () => clearTimeout(timer);
	}, [copied]);
	useEffect(() => {
		if (manual) {
			text.current?.focus({ preventScroll: true });
			text.current?.select();
		}
	}, [manual]);
	async function copy(item: CheckoutCommand) {
		setCopied(undefined);
		try {
			await navigator.clipboard.writeText(item.command);
			setManual(undefined);
			setCopied(item);
			toast({ text: `${item.label} checkout command copied` });
		} catch {
			manualFocus.current = true;
			setManual(item);
		}
	}
	if (!context.pr && !context.branch && !context.ticket) return null;
	return (
		<div className="review-context">
			<nav className="review-context-row" aria-label="Review context">
				{context.pr && (
					<External href={context.pr.url}>{context.pr.label} ↗</External>
				)}
				{context.branch && (
					<span className="review-branch">
						<span className="muted">Branch</span>{" "}
						{context.branchUrl ? (
							<External href={context.branchUrl}>
								<code>{context.branch}</code> ↗
							</External>
						) : (
							<code>{context.branch}</code>
						)}
					</span>
				)}
				{context.ticket && (
					<External href={context.ticket.url}>
						Ticket: {context.ticket.label} ↗
					</External>
				)}
				{context.commands.length > 0 && (
					<Dropdown.Root
						onOpenChange={(open) => {
							if (open) manualFocus.current = false;
						}}
					>
						<Dropdown.Trigger asChild>
							<Button variant="secondary" aria-label="Copy checkout">
								<CopyIcon copied={Boolean(copied)} />
								{copied ? "Copied" : "Copy checkout"} ▾
							</Button>
						</Dropdown.Trigger>
						<Dropdown.Portal>
							<Dropdown.Content
								className="theme-menu checkout-menu"
								sideOffset={8}
								align="start"
								collisionPadding={16}
								aria-label="Copy checkout command"
								onCloseAutoFocus={(event) => {
									if (manualFocus.current) {
										event.preventDefault();
										text.current?.focus({ preventScroll: true });
										text.current?.select();
									}
									manualFocus.current = false;
								}}
							>
								{context.commands.map((item) => (
									<Dropdown.Item
										key={item.label}
										className="theme-option checkout-option"
										textValue={item.label}
										aria-label={`Copy ${item.label} checkout command`}
										onSelect={() => void copy(item)}
									>
										<code>{item.command}</code>
										<CopyIcon copied={copied?.command === item.command} />
									</Dropdown.Item>
								))}
							</Dropdown.Content>
						</Dropdown.Portal>
					</Dropdown.Root>
				)}
			</nav>
			{manual && (
				<div className="checkout-fallback">
					<p role="alert">
						Clipboard access failed. Select and copy the command below.
					</p>
					<label htmlFor="manual-checkout">
						{manual.label} checkout command
					</label>
					<textarea
						id="manual-checkout"
						ref={text}
						readOnly
						value={manual.command}
						rows={3}
						onFocus={(event) => event.currentTarget.select()}
					/>
					<small className="muted">{manual.help}</small>
				</div>
			)}
		</div>
	);
}
