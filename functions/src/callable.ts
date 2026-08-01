import {logger} from "firebase-functions";
import {
  HttpsError,
  onCall,
  type CallableOptions,
  type CallableRequest,
} from "firebase-functions/v2/https";
import {z} from "zod";
import {assertPayloadSize, safeRequestId} from "./utils.js";

type Handler<S extends z.ZodType> = (
  input: z.output<S>,
  request: CallableRequest,
  requestId: string,
) => Promise<unknown>;

function errorCode(error: unknown): string {
  if (error instanceof HttpsError) {
    return error.code;
  }
  if (error instanceof z.ZodError) {
    return "invalid-argument";
  }
  return "internal";
}

export function callable<S extends z.ZodType>(
  functionName: string,
  schema: S,
  handler: Handler<S>,
  options: CallableOptions = {},
) {
  return onCall(
    {
      enforceAppCheck: false,
      consumeAppCheckToken: false,
      cors: true,
      ...options,
    },
    async (request) => {
      const startedAt = Date.now();
      const rawRequestId =
        request.data !== null &&
        typeof request.data === "object" &&
        "requestId" in request.data &&
        typeof request.data.requestId === "string"
          ? request.data.requestId
          : undefined;
      const requestId = safeRequestId(rawRequestId);

      try {
        assertPayloadSize(request.data);
        const parsed = schema.safeParse(request.data);
        if (!parsed.success) {
          throw new HttpsError(
            "invalid-argument",
            "The request contains invalid fields.",
            {
              requestId,
              issues: parsed.error.issues.map((issue) => ({
                path: issue.path.join("."),
                message: issue.message,
              })),
            },
          );
        }

        const result = await handler(parsed.data, request, requestId);
        logger.info("Callable completed", {
          functionName,
          requestId,
          uid: request.auth?.uid ?? null,
          appCheckPresent: request.app !== undefined,
          durationMs: Date.now() - startedAt,
          outcome: "success",
        });
        return {ok: true, requestId, result};
      } catch (error: unknown) {
        const code = errorCode(error);
        logger.error("Callable failed", {
          functionName,
          requestId,
          uid: request.auth?.uid ?? null,
          durationMs: Date.now() - startedAt,
          safeErrorCode: code,
          error:
            error instanceof Error
              ? {name: error.name.slice(0, 80)}
              : {name: "UnknownError"},
        });
        if (error instanceof HttpsError) {
          throw error;
        }
        throw new HttpsError(
          "internal",
          "The request could not be completed.",
          {requestId},
        );
      }
    },
  );
}
