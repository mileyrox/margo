import { getAuth } from "@clerk/express";
import { db, usersTable, type User } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { RequestHandler } from "express";

declare global {
  namespace Express {
    interface Request {
      dbUser: User;
      identityEmail: string | null;
    }
  }
}

// Keep the existing ID bridge: migrated users retain their original local ID.
// Nullable identity columns stay untouched; Clerk is the source of truth.
export const requireAuth: RequestHandler = async (req, res, next) => {
  const auth = getAuth(req);
  if (!auth.userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const userId = auth.sessionClaims?.userId;
  if (typeof userId !== "string" || !userId) {
    res.status(403).json({ error: "Your account identity could not be resolved." });
    return;
  }
  try {
    let [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (!user) {
      [user] = await db.insert(usersTable).values({ id: userId }).onConflictDoNothing().returning();
      if (!user) [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    }
    if (!user) {
      res.status(403).json({ error: "Your account is not available." });
      return;
    }
    req.dbUser = user;
    req.identityEmail = typeof auth.sessionClaims?.email === "string" ? auth.sessionClaims.email : null;
    next();
  } catch (error) {
    next(error);
  }
};
