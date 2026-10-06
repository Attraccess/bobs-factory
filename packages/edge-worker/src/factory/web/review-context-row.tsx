import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { useEffect, useRef, useState } from "react";
import { type CheckoutCommand, reviewContext } from "./review-context";
import { Button, External, useToast } from "./ui";

export function ReviewContextRow({ run }: { run: unknown }) {
	const context = reviewContext(run),
		toast = useToast();
	const [manual, setManual] = useState<CheckoutCommand>();
	const text = useRef<HTMLTextAreaElement>(null);
	const manualFocus = useRef(false);
	useEffect(() => {
		if (manual) {
			text.current?.focus({ preventScroll: true });
			text.current?.select();
		}
	}, [manual]);
	async function copy(item: CheckoutCommand) {
		try {
			await navigator.clipboard.writeText(item.command);
			setManual(undefined);
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
							<Button variant="secondary">Copy checkout ▾</Button>
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
										<strong>{item.label}</strong>
										<code>{item.command}</code>
										<small>{item.help}</small>
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
