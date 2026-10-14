// The image formats the upstream provenance provider accepts, and the input size
// ceiling derived from the same policy. Browser validation, the server route, and
// the provider adapter all read this list, so the client can never accept a format
// the route would reject with "invalid-input".
export const SUPPORTED_IMAGE_MIME = Object.freeze(['image/jpeg', 'image/png', 'image/webp'] as const)

export const MAX_INPUT_BYTES = 25 * 1024 * 1024