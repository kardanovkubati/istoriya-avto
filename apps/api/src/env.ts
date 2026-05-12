import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().url().default("postgresql://postgres:postgres@localhost:5432/istoriya_avto"),
  PUBLIC_WEB_URL: z.string().url().default("http://localhost:5173"),
  PUBLIC_API_URL: z.string().url().default("http://localhost:3001"),
  REPORT_STORAGE_DRIVER: z.enum(["local"]).default("local"),
  REPORT_STORAGE_LOCAL_DIR: z.string().min(1).default(".local/report-uploads"),
  REPORT_ORIGINAL_RETENTION_DAYS: z.coerce.number().int().positive().default(180),
  MAX_REPORT_UPLOAD_BYTES: z.coerce.number().int().positive().default(20 * 1024 * 1024)
});

export const env = envSchema.parse(process.env);
