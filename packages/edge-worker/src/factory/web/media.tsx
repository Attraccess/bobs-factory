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
