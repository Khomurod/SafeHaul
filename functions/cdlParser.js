const functions = require("firebase-functions/v1");
const { db } = require("./firebaseAdmin");
const { checkRateLimit } = require("./shared/rateLimiter");
const { assertCompanyAcceptingIntake } = require("./shared/companyTenant");

const DEFAULT_GROQ_MODEL = process.env.GROQ_VISION_MODEL || "meta-llama/llama-4-scout-17b-16e-instruct";
const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/responses";

const STRICT_JSON_SCHEMA = {
    type: "object",
    properties: {
        firstName: { type: "string" },
        lastName: { type: "string" },
        dateOfBirth: { type: "string" },
        fullAddress: { type: "string" },
        cdlNumber: { type: "string" },
        expirationDate: { type: "string" },
    },
    required: [
        "firstName",
        "lastName",
        "dateOfBirth",
        "fullAddress",
        "cdlNumber",
        "expirationDate",
    ],
    additionalProperties: false,
};

function normalizeOutput(payload) {
    const safe = payload && typeof payload === "object" ? payload : {};
    return {
        firstName: String(safe.firstName || "").trim(),
        lastName: String(safe.lastName || "").trim(),
        dateOfBirth: String(safe.dateOfBirth || "").trim(),
        fullAddress: String(safe.fullAddress || "").trim(),
        cdlNumber: String(safe.cdlNumber || "").trim(),
        expirationDate: String(safe.expirationDate || "").trim(),
    };
}

function extractJsonObject(text) {
    if (!text || typeof text !== "string") return null;
    const trimmed = text.trim();
    try {
        return JSON.parse(trimmed);
    } catch (_) {
        // keep trying below
    }

    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    const candidate = trimmed.slice(start, end + 1);
    try {
        return JSON.parse(candidate);
    } catch (_) {
        return null;
    }
}

function extractAssistantTextFromResponses(payload) {
    const output = Array.isArray(payload?.output) ? payload.output : [];
    for (const item of output) {
        if (item?.type !== "message") continue;
        const content = Array.isArray(item.content) ? item.content : [];
        for (const part of content) {
            if (part?.type === "output_text" && typeof part.text === "string" && part.text.trim()) {
                return part.text;
            }
        }
    }
    return "";
}

exports.parseCdlWithGroq = functions
    .runWith({ memory: "512MB", timeoutSeconds: 60, secrets: ["GROQ_API_KEY"] })
    .https.onCall(async (data, context) => {
        const { companyId, imageDataUrl, storagePath } = data || {};

        if (!companyId || typeof companyId !== "string") {
            throw new functions.https.HttpsError("invalid-argument", "companyId is required.");
        }
        if (!imageDataUrl || typeof imageDataUrl !== "string" || !imageDataUrl.startsWith("data:image/")) {
            throw new functions.https.HttpsError("invalid-argument", "imageDataUrl must be a data:image/* base64 URL.");
        }

        await assertCompanyAcceptingIntake(db, companyId);

        const clientIp = context.rawRequest?.ip || "unknown_guest";
        const isAllowed = await checkRateLimit(`cdl_ocr_${clientIp}`, 6, 60, "closed");
        if (!isAllowed) {
            throw new functions.https.HttpsError(
                "resource-exhausted",
                "Too many auto-fill attempts. Please wait a minute and try again."
            );
        }

        const apiKey = process.env.GROQ_API_KEY;
        if (!apiKey) {
            throw new functions.https.HttpsError("failed-precondition", "GROQ_API_KEY is not configured on the server.");
        }

        const prompt = [
            "You are an OCR data extractor for US Commercial Driver Licenses (CDL).",
            "Return ONLY strict JSON. No markdown. No prose.",
            "Required keys: firstName, lastName, dateOfBirth, fullAddress, cdlNumber, expirationDate.",
            "If a value is missing or unreadable, return empty string for that key.",
            "Keep dates exactly as printed on the card when possible.",
            "For fullAddress, prefer USPS-style with commas: street line, city, ST ZIP (ZIP+4 ok).",
            "If the card prints on one line with no commas, keep that single line; do not invent commas.",
        ].join(" ");

        const requestBody = {
            model: DEFAULT_GROQ_MODEL,
            temperature: 0,
            max_output_tokens: 450,
            text: {
                format: {
                    type: "json_schema",
                    name: "cdl_extraction",
                    schema: STRICT_JSON_SCHEMA,
                },
            },
            input: [
                {
                    role: "user",
                    content: [
                        { type: "input_text", text: prompt },
                        { type: "input_image", image_url: imageDataUrl },
                    ],
                },
            ],
        };

        let response;
        try {
            response = await fetch(GROQ_ENDPOINT, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(requestBody),
            });
        } catch (networkErr) {
            console.error("[parseCdlWithGroq] Groq network error:", networkErr);
            throw new functions.https.HttpsError("unavailable", "Could not reach AI service. Please retry.");
        }

        if (!response.ok) {
            const errText = await response.text().catch(() => "");
            console.error("[parseCdlWithGroq] Groq API error:", response.status, errText);
            throw new functions.https.HttpsError("internal", "AI parsing failed. Please retry with a clearer photo.");
        }

        const raw = await response.json();
        const content = extractAssistantTextFromResponses(raw);
        const parsed = extractJsonObject(content);

        if (!parsed) {
            console.error("[parseCdlWithGroq] Non-JSON model output:", content);
            throw new functions.https.HttpsError("internal", "AI returned unreadable data. Please retry.");
        }

        const normalized = normalizeOutput(parsed);
        if (!normalized.firstName && !normalized.lastName && !normalized.cdlNumber) {
            throw new functions.https.HttpsError(
                "failed-precondition",
                "Could not read enough CDL data. Please upload a clearer, straight-on photo."
            );
        }

        return {
            success: true,
            fields: normalized,
            sourceModel: DEFAULT_GROQ_MODEL,
            storagePath: storagePath || null,
            schema: STRICT_JSON_SCHEMA,
        };
    });

exports.__private = {
    normalizeOutput,
    extractJsonObject,
    extractAssistantTextFromResponses,
};

