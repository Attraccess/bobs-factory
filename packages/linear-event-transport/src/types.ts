/**
 * Types for Linear event transport
 */

import type { AgentEvent, InternalMessage } from "bobs-factory-core";
import type { FastifyInstance } from "fastify";

/**
 * Verification mode for Linear webhooks
 * - 'direct': Use LINEAR_WEBHOOK_SECRET for Linear signature verification
 * - 'proxy': Use BOBS_FACTORY_API_KEY Bearer token for proxy authentication
 */
export type VerificationMode = "direct" | "proxy";

/**
 * Configuration for LinearEventTransport
 */
export interface LinearEventTransportConfig {
	/** Fastify server instance to mount routes on */
	fastifyServer: FastifyInstance;
	/** Verification mode: 'direct' or 'proxy' */
	verificationMode: VerificationMode;
	/** Secret for verification (LINEAR_WEBHOOK_SECRET or BOBS_FACTORY_API_KEY) */
	secret: string;
	/** Optional IP allowlist for webhook source validation (only used in direct mode) */
	ipAllowlist?: readonly string[] | (() => readonly string[]);
}

/**
 * Events emitted by LinearEventTransport
 */
export interface LinearEventTransportEvents {
	/** Emitted when a webhook is received and verified (legacy) */
	event: (event: AgentEvent) => void;
	/** Emitted when a unified internal message is received */
	message: (message: InternalMessage) => void;
	/** Emitted when an error occurs */
	error: (error: Error) => void;
}
