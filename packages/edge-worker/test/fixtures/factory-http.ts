import { request } from "node:http";
import { Readable } from "node:stream";
// Node fetch rewrites Host; native HTTP models a tunnel that preserves public authority.
export function factoryHttp(
	url: string,
	headers: Record<string, string>,
	signal?: AbortSignal,
): Promise<Response> {
	return new Promise((resolve, reject) => {
		const req = request(url, { headers, signal }, (response) => {
			const responseHeaders = new Headers();
			for (const [name, value] of Object.entries(response.headers))
				if (value !== undefined)
					responseHeaders.set(
						name,
						Array.isArray(value) ? value.join(", ") : value,
					);
			resolve(
				new Response(Readable.toWeb(response) as ReadableStream<Uint8Array>, {
					status: response.statusCode,
					headers: responseHeaders,
				}),
			);
		});
		req.on("error", reject);
		req.end();
	});
}
