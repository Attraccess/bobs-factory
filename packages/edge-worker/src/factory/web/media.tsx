import { type ImgHTMLAttributes, useEffect, useRef, useState } from "react";
/** Keep off-screen assets out of the network; allow a small next-screen buffer. */
export function LazyImage({
	src,
	alt,
	...props
}: ImgHTMLAttributes<HTMLImageElement>) {
	const image = useRef<HTMLImageElement>(null),
		[visible, setVisible] = useState(false);
	useEffect(() => {
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) {
					setVisible(true);
					observer.disconnect();
				}
			},
			{ rootMargin: "160px" },
		);
		if (image.current) observer.observe(image.current);
		return () => observer.disconnect();
	}, []);
	return (
		<img
			{...props}
			alt={alt ?? ""}
			ref={image}
			src={visible ? src : undefined}
			loading="lazy"
			decoding="async"
			style={{ aspectRatio: "4 / 3", ...props.style }}
		/>
	);
}

export interface VideoInventory {
	taskId: string;
	caption: string;
	transcript: string;
	duration: number;
	mime: string;
	sha256: string;
	captions: boolean;
	available: boolean;
}
export function videoUrl(
	runId: string,
	video: Pick<VideoInventory, "taskId" | "sha256">,
	asset = "media",
) {
	return `/api/runs/${encodeURIComponent(runId)}/videos/${encodeURIComponent(video.taskId)}/${asset}?v=${encodeURIComponent(video.sha256)}`;
}
/** Media is fetched only after the reader explicitly opens it. No autoplay or prefetch. */
export function LazyVideo({
	runId,
	video,
}: {
	runId: string;
	video: VideoInventory;
}) {
	const [opened, setOpened] = useState(false),
		[failed, setFailed] = useState(false),
		player = useRef<HTMLVideoElement>(null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: Opening or changing the recording must tear down its previous player.
	useEffect(() => {
		const element = player.current;
		return () => {
			element?.pause();
			element?.removeAttribute("src");
			element?.load();
		};
	}, [video.sha256, opened]);
	return (
		<figure className="evidence-video">
			<figcaption>
				<strong>{video.caption}</strong> · {Math.ceil(video.duration)} seconds
			</figcaption>
			{!video.available ? (
				<p role="status">
					This recording is missing or expired. Read the transcript below.
				</p>
			) : failed ? (
				<p role="status">
					Playback is unavailable or this revision changed. Refresh the run or
					read the transcript below.
				</p>
			) : opened ? (
				// biome-ignore lint/a11y/useMediaCaption: Silent clips use transcripts; runtime requires timed tracks for audio.
				<video
					ref={player}
					controls
					playsInline
					preload="none"
					poster={videoUrl(runId, video, "poster")}
					aria-label={video.caption}
					onError={() => setFailed(true)}
				>
					<source src={videoUrl(runId, video)} type={video.mime} />
					{video.captions && (
						<track
							kind="captions"
							label="Demonstration captions"
							srcLang="en"
							src={videoUrl(runId, video, "captions")}
							default
						/>
					)}
					Your browser cannot play this recording. Read the transcript below.
				</video>
			) : (
				<>
					<LazyImage
						src={videoUrl(runId, video, "poster")}
						alt={`Poster: ${video.caption}`}
						style={{ aspectRatio: "auto" }}
					/>
					<button
						type="button"
						className="button secondary"
						onClick={() => setOpened(true)}
					>
						Open recording
					</button>
				</>
			)}
			<details>
				<summary>Transcript and demonstrated steps</summary>
				<p style={{ whiteSpace: "pre-wrap" }}>{video.transcript}</p>
			</details>
		</figure>
	);
}
