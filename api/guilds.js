import { randomBytes } from "node:crypto";
import { Router } from "express";
import { HttpError, asyncHandler, serialize } from "./shared.js";

const MAX_MEMBERS = 100;
const MESSAGE_LIMIT = 100;

function textField(value, label, maxLength, { optional = false } = {}) {
  if (optional && value == null) return "";
  if (typeof value !== "string") throw new HttpError(400, `${label} must be text.`);
  const text = value.trim();
  if (!optional && !text) throw new HttpError(400, `${label} is required.`);
  if (text.length > maxLength) {
    throw new HttpError(400, `${label} must be ${maxLength} characters or fewer.`);
  }
  return text;
}

function membersOf(guild) {
  return [...new Set((Array.isArray(guild.members) ? guild.members : [])
    .filter((uid) => typeof uid === "string" && uid && !uid.includes("/")))];
}

function requireMember(snapshot, uid) {
  if (!snapshot.exists) throw new HttpError(404, "Guild not found.");
  const guild = snapshot.data();
  if (!membersOf(guild).includes(uid)) {
    throw new HttpError(403, "You must be a guild member to access this guild.");
  }
  return guild;
}

function presentGuild(id, guild) {
  return serialize({
    id,
    name: guild.name || "Guild",
    description: guild.description || "",
    inviteCode: guild.inviteCode || "",
    createdBy: guild.createdBy || "",
    createdAt: guild.createdAt || null,
    memberCount: membersOf(guild).length,
  });
}

function guildReference(db, id) {
  if (typeof id !== "string" || !id || id.includes("/") || id.length > 1500) {
    throw new HttpError(400, "Invalid guild ID.");
  }
  return db.collection("guilds").doc(id);
}

function memberName(profile) {
  const name = profile?.username || profile?.displayName;
  return typeof name === "string" && name.trim() ? name.trim().slice(0, 80) : "Adventurer";
}

export function createGuildRouter({ db }) {
  const router = Router();

  // Authentication is verified by the parent API router; never accept a body UID.
  router.use((req, _res, next) => {
    if (!req.auth?.uid) return next(new HttpError(401, "Authentication required."));
    next();
  });

  router.get("/guilds", asyncHandler(async (req, res) => {
    const snapshot = await db.collection("guilds")
      .where("members", "array-contains", req.auth.uid).get();
    const guilds = snapshot.docs.map((doc) => presentGuild(doc.id, doc.data()));
    guilds.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    res.json({ guilds });
  }));

  router.post("/guilds", asyncHandler(async (req, res) => {
    const name = textField(req.body?.name, "Guild name", 80);
    const description = textField(req.body?.description, "Description", 500, { optional: true });
    const uid = req.auth.uid;
    const guildRef = db.collection("guilds").doc();

    // Check every candidate in the transaction, including collisions with legacy guilds.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const inviteCode = randomBytes(12).toString("hex").toUpperCase();
      const guild = await db.runTransaction(async (transaction) => {
        const collision = await transaction.get(db.collection("guilds")
          .where("inviteCode", "==", inviteCode).limit(1));
        if (!collision.empty) return null;
        const user = await transaction.get(db.collection("users").doc(uid));
        if (!user.exists) throw new HttpError(404, "User profile not found.");
        const data = { name, description, inviteCode, members: [uid], createdBy: uid, createdAt: new Date() };
        transaction.set(guildRef, data);
        return data;
      });
      if (guild) return res.status(201).json({ guild: presentGuild(guildRef.id, guild) });
    }
    throw new HttpError(503, "Could not generate a guild invitation. Please try again.");
  }));

  router.post("/guilds/join", asyncHandler(async (req, res) => {
    const code = textField(req.body?.code, "Invite code", 64).toUpperCase();
    if (!/^[A-Z0-9]+$/.test(code)) throw new HttpError(400, "Invalid invite code.");
    const uid = req.auth.uid;
    const guild = await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(db.collection("guilds")
        .where("inviteCode", "==", code).limit(1));
      if (snapshot.empty) throw new HttpError(404, "Invite code not found.");
      const guildDoc = snapshot.docs[0];
      const data = guildDoc.data();
      const members = membersOf(data);
      if (members.includes(uid)) return presentGuild(guildDoc.id, data);
      if (members.length >= MAX_MEMBERS) throw new HttpError(409, "This guild is full (100 members).");
      const user = await transaction.get(db.collection("users").doc(uid));
      if (!user.exists) throw new HttpError(404, "User profile not found.");
      const updated = { ...data, members: [...members, uid] };
      transaction.update(guildReference(db, guildDoc.id), { members: updated.members });
      return presentGuild(guildDoc.id, updated);
    });
    res.json({ guild });
  }));

  router.post("/guilds/:id/leave", asyncHandler(async (req, res) => {
    const guildRef = guildReference(db, req.params.id);
    const uid = req.auth.uid;
    await db.runTransaction(async (transaction) => {
      const guild = requireMember(await transaction.get(guildRef), uid);
      const members = membersOf(guild).filter((member) => member !== uid);
      if (!members.length) {
        // Chat history becomes inaccessible immediately when its parent guild is gone.
        transaction.delete(guildRef);
      } else {
        const createdBy = guild.createdBy === uid || !members.includes(guild.createdBy)
          ? [...members].sort()[0]
          : guild.createdBy;
        transaction.update(guildRef, { members, createdBy });
      }
    });
    res.json({ message: "You left the guild." });
  }));

  router.get("/guilds/:id/messages", asyncHandler(async (req, res) => {
    const guildRef = guildReference(db, req.params.id);
    const result = await db.runTransaction(async (transaction) => {
      const guild = requireMember(await transaction.get(guildRef), req.auth.uid);
      const messageQuery = db.collection("guildChats").doc(guildRef.id).collection("messages")
        .orderBy("createdAt", "desc").limit(MESSAGE_LIMIT);
      const messageSnapshot = await transaction.get(messageQuery);
      const memberSnapshots = await Promise.all(membersOf(guild).map((uid) =>
        transaction.get(db.collection("users").doc(uid))));
      const members = memberSnapshots.map((doc) => ({ id: doc.id, username: memberName(doc.data()) }));
      const names = new Map(members.map((member) => [member.id, member.username]));
      const messages = messageSnapshot.docs.map((doc) => {
        const message = doc.data();
        const senderId = message.senderId || message.authorId || "";
        return serialize({
          id: doc.id,
          senderId,
          senderName: message.system ? "System" : message.senderName || names.get(senderId) || "Adventurer",
          text: typeof message.text === "string" ? message.text : "",
          createdAt: message.createdAt || null,
        });
      }).reverse();
      return { messages, members };
    });
    res.json(result);
  }));

  router.post("/guilds/:id/messages", asyncHandler(async (req, res) => {
    const guildRef = guildReference(db, req.params.id);
    const text = textField(req.body?.text, "Message", 2000);
    const uid = req.auth.uid;
    const messageRef = db.collection("guildChats").doc(guildRef.id).collection("messages").doc();
    const message = await db.runTransaction(async (transaction) => {
      requireMember(await transaction.get(guildRef), uid);
      const user = await transaction.get(db.collection("users").doc(uid));
      if (!user.exists) throw new HttpError(404, "User profile not found.");
      const data = { senderId: uid, senderName: memberName(user.data()), text, createdAt: new Date() };
      transaction.set(messageRef, data);
      return serialize({ id: messageRef.id, ...data });
    });
    res.status(201).json({ message });
  }));

  return router;
}
