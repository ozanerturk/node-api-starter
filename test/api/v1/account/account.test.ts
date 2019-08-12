jest.mock("nodemailer");
import nodemailer from "nodemailer";
import bcrypt from "bcrypt";
import request from "supertest";
import jwt from "jsonwebtoken";

import { initMongo, disconnectMongo } from "setup";
import { SESSION_SECRET } from "config/secrets";
import { User } from "models/User";

interface JWTPayload {
    email: string;
    role: string;
    sub: string;
    exp: number;
}
interface JWTData {
    id: string;
    email: string;
    role: string;
    exp: string;
}

const REGISTER_VALID = {
    email: "valid@email.com",
    password: "valid_password"
};

const signToken = (data: JWTData): string => jwt.sign({
    email: data.email,
    role: data.role
}, SESSION_SECRET, { 
    expiresIn: data.exp,
    subject: data.id
});

const registerValidUser = async (role: string = "user", jwtExpiration: string = "1s"): Promise<string> => {
    const user = {
        email: REGISTER_VALID.email,
        password: REGISTER_VALID.password,
        id: "b27e8455-eac8-47c9-babc-8a8a6be5e4ae",
        role: role
    };

    await User.create(user);

    return signToken({
        id: user.id,
        email: user.email,
        role: role,
        exp: jwtExpiration
    });
};

import app from "app";

describe("API V1", (): void => {
    describe("/v1/account", (): void => {
        
        describe("GET /", (): void => {
            beforeEach(async (): Promise<void> => {
                await initMongo();
                await registerValidUser("admin");
            });
            afterAll(async (): Promise<void> => disconnectMongo());

            it("returns a list of users", async (): Promise<void> => {
                const user = await User.findOne({});
                await request(app)
                    .get("/v1/account/")
                    .set("authorization", `Bearer ${signToken({
                        email: user.email,
                        id: user.id,
                        role: user.role,
                        exp: "1s"
                    })}`)
                    .expect(200, {
                        Data: [
                            {
                                id: user.id,
                                email: user.email,
                                role: user.role,
                                avatar: "https://gravatar.com/avatar/cb7529c9a7c3297760ec76e41bf77d0a?s=200&d=retro",
                                profile: {}
                            }
                        ]
                    });
            });
        });

        describe("GET /jwt/refresh", (): void => {
            beforeEach(async (): Promise<void> => initMongo());
            afterAll(async (): Promise<void> => disconnectMongo());

            it("should return a fresher JWT", async (): Promise<void> => {
                const token = await registerValidUser();
                const payload = await jwt.verify(token, SESSION_SECRET) as JWTPayload;
                const expiringToken = signToken({
                    id: payload.sub,
                    email: payload.email,
                    role: "user",
                    exp: "1s"
                });
                const refresh = await request(app)
                    .get("/v1/account/jwt/refresh")
                    .set("authorization", `Bearer ${expiringToken}`);

                const freshPayload = await jwt.verify(refresh.body.token, SESSION_SECRET) as JWTPayload;
                const oldPayload = await jwt.verify(expiringToken, SESSION_SECRET) as JWTPayload;
                expect(freshPayload.exp > oldPayload.exp).toBe(true);
            });

            it("should return 401 - token is valid but the user does not exist", async (): Promise<void> => {
                const token = await registerValidUser();
                await User.deleteMany({});
                const refresh = await request(app)
                    .get("/v1/account/jwt/refresh")
                    .set("authorization", `Bearer ${token}`);
                expect(refresh.status).toBe(401);
            });
        });

        describe("POST /register", (): void => {

            const REGISTER_INVALID_EMAIL_PASSWORD = {
                "email": "a@a.a",
                "password": "pass"
            };

            beforeEach(async (): Promise<void> => initMongo());
            afterAll(async (): Promise<void> => disconnectMongo());
        
            it("should return status 201, create a user and return a JWT - valid register", async (): Promise<void> => {
                const response = await request(app)
                    .post("/v1/account/register")
                    .send(REGISTER_VALID);

                expect(response.status).toBe(201);
                const payload = await jwt.verify(response.body.token, SESSION_SECRET);
                expect((payload as JWTPayload).email).toBe(REGISTER_VALID.email);
            });
        
            it("should return status 422 - invalid email and password", async (): Promise<void> => {
                await request(app)
                    .post("/v1/account/register")
                    .send(REGISTER_INVALID_EMAIL_PASSWORD)
                    .expect(422, {
                        errors: [
                            {
                                msg: "Please enter a valid email address"
                            },
                            {
                                msg: "Password must be at least 8 characters long"
                            }
                        ]
                    });
            });
        
            it("should return status 422 - duplicate account", async (): Promise<void> => {
                await request(app).post("/v1/account/register").send(REGISTER_VALID);
                await request(app)
                    .post("/v1/account/register")
                    .send(REGISTER_VALID)
                    .expect(422, {
                        errors: [
                            {
                                msg: "Account already exists"
                            }
                        ]
                    });
            });
        
        });
        
        describe("POST /login", (): void => {  
            beforeEach(async (): Promise<void> => initMongo());
            afterAll(async (): Promise<void> => disconnectMongo());
            
            it("should return status 200 and the user's JWT - valid login", async (): Promise<void> => {
                await registerValidUser();
                const response = await request(app)
                    .post("/v1/account/login")
                    .send(REGISTER_VALID);
                expect(response.status).toBe(200);
                const payload = await jwt.verify(response.body.token, SESSION_SECRET);
                expect((payload as JWTPayload).email).toBe(REGISTER_VALID.email);
            });

            it("should return status 403 - email not registered", async (): Promise<void> => {
                await request(app)
                    .post("/v1/account/login")
                    .send(REGISTER_VALID)
                    .expect(403, {
                        errors: [{ msg: "Email not registered" }]
                    });
            });

            it("should return status 403 - invalid credentials", async (): Promise<void> => {
                await registerValidUser();
                await request(app)
                    .post("/v1/account/login")
                    .send({
                        email: REGISTER_VALID.email,
                        password: "wrong_password"
                    })
                    .expect(403, {
                        errors: [{ msg: "Invalid credentials" }]
                    });
            });

            it("should return status 403 - no payload", async (): Promise<void> => {
                await registerValidUser();
                await request(app)
                    .post("/v1/account/login")
                    .send({})
                    .expect(403, {
                        errors: [{ msg: "Invalid credentials" }]
                    });
            });

        });

        describe("POST /forgot", (): void => {
            let sendMailMock: jest.Mock;
            beforeEach(async (): Promise<void> => {
                sendMailMock = jest.fn();
                (nodemailer.createTransport as jest.Mock).mockReturnValue({"sendMail": sendMailMock});

                await initMongo();
                await registerValidUser();
            });
            afterAll(async (): Promise<void> => disconnectMongo());
            
            it("should return 201, set a password reset token and send an email", async (): Promise<void> => {
                await request(app)
                    .post("/v1/account/forgot")
                    .send({ email: REGISTER_VALID.email })
                    .expect(201);
                
                const user = await User.findOne({});
                expect(user.passwordResetToken).toBeDefined();
                expect(sendMailMock).toHaveBeenCalled();
            });

            it("should return 422, does not set a password reset token or send an email - no data", async (): Promise<void> => {
                await request(app)
                    .post("/v1/account/forgot")
                    .send({})
                    .expect(422, {
                        errors: [{ msg: "Invalid data" }]
                    });
                const user = await User.findOne({});
                expect(user.passwordResetToken).toBeUndefined();
                expect(sendMailMock).toBeCalledTimes(0);
            });

            it("should return 404, does not set a password reset token or send an email - email not registered", async (): Promise<void> => {
                await request(app)
                    .post("/v1/account/forgot")
                    .send({ email: "not@registered.email" })
                    .expect(404, {
                        errors: [{ msg: "Email not found" }]
                    });
                const user = await User.findOne({});
                expect(user.passwordResetToken).toBeUndefined();
                expect(sendMailMock).toBeCalledTimes(0);
            });
        });

        describe("POST /reset/:token", (): void => {
            let sendMailMock: jest.Mock;
            const RESET_PASSWORD_VALID = {
                password: "different_valid_password",
                confirm: "different_valid_password"
            };
            const RESET_PASSWORD_INVALID = {
                password: "pass",
                confirm: "different_password"
            };
            beforeEach(async (): Promise<void> => {
                sendMailMock = jest.fn();
                (nodemailer.createTransport as jest.Mock).mockReturnValue({"sendMail": sendMailMock});
                await initMongo();
                await User.create({
                    email: "valid@email.com",
                    password: "$2b$10$dn9jixNaX2WCvnVWBfW4aucSPTS41hzE9.A3n7QLPL4bkHQ.6eCqK",
                    id: "b27e8455-eac8-47c9-babc-8a8a6be5e4ae",
                    passwordResetExpires: new Date(Date.now() + 60 * 60 * 1000),
                    passwordResetToken: "4ec7149e1c5d55721a9cb2b069c22ac0"
                });
            });
            afterAll(async (): Promise<void> => disconnectMongo());

            it("should return 201 and reset the password", async(): Promise<void> => {
                let user = await User.findOne({});
                await request(app)
                    .post(`/v1/account/reset/${user.passwordResetToken}`)
                    .send(RESET_PASSWORD_VALID)
                    .expect(201);
                user = await User.findOne({});
                expect(sendMailMock).toHaveBeenCalled();
                expect(await user.authenticate(RESET_PASSWORD_VALID.password)).toBe(true);
            });

            it("should return 422 - password mismatch, password too short and invalid token", async(): Promise<void> => {
                await request(app)
                    .post("/v1/account/reset/invalid_token")
                    .send(RESET_PASSWORD_INVALID)
                    .expect(422, {
                        errors: [
                            { msg: "Password must be at least 8 characters long" },
                            { msg: "Passwords do not match" },
                            { msg: "Invalid token" }
                        ]
                    });
                expect(sendMailMock).toBeCalledTimes(0);
            });

            it("should return 422 - expired token", async(): Promise<void> => {
                const user = await User.findOne({});
                user.passwordResetExpires = new Date(Date.now() - 1000);
                await user.save();
                await request(app)
                    .post(`/v1/account/reset/${user.passwordResetExpires}`)
                    .send(RESET_PASSWORD_VALID)
                    .expect(422, {
                        errors: [{ msg: "Invalid token" }]
                    });
                expect(sendMailMock).toBeCalledTimes(0);
            });
        });

        describe("POST /profile", (): void => {
            beforeEach(async (): Promise<void> => {
                await initMongo();
            });
            afterAll(async (): Promise<void> => disconnectMongo());
            const PROFILE_DATA = {
                name: "Valid User",
                gender: "User",
                location: "Userland",
                website: "valid.user.com"
            };

            it("should return 200 and change the user's profile information", async (): Promise<void> => {
                const token = await registerValidUser();
                await request(app)
                    .post("/v1/account/profile")
                    .set("authorization", `Bearer ${token}`)
                    .send(PROFILE_DATA)
                    .expect(200);
                const user = await User.findOne({});
                expect(user.profile.name).toBe(PROFILE_DATA.name);
                expect(user.profile.gender).toBe(PROFILE_DATA.gender);
                expect(user.profile.location).toBe(PROFILE_DATA.location);
                expect(user.profile.website).toBe(PROFILE_DATA.website);
            });

            it("should return 401 - invalid authorization token", async (): Promise<void> => {
                await registerValidUser();
                await request(app)
                    .post("/v1/account/profile")
                    .send(PROFILE_DATA)
                    .expect(401);
                const user = await User.findOne({});
                expect(user.profile.name).toBeUndefined();
                expect(user.profile.gender).toBeUndefined();
                expect(user.profile.location).toBeUndefined();
                expect(user.profile.website).toBeUndefined();
            });
        });

        describe("POST /password", (): void => {
            beforeEach(async (): Promise<void> => initMongo());
            afterAll(async (): Promise<void> => disconnectMongo());

            const VALID_PASSWORD_PAYLOAD = {
                password: "newValidPassword",
                confirm: "newValidPassword"
            };

            const INVALID_PASSWORD_PAYLOAD = {
                password: "short",
                confirm: "wrong"
            };

            it("should return 200 and change the user's password", async (): Promise<void> => {
                const token = await registerValidUser();
                await request(app)
                    .post("/v1/account/password")
                    .set("authorization", `Bearer ${token}`)
                    .send(VALID_PASSWORD_PAYLOAD)
                    .expect(200);
                const user = await User.findOne({});
                expect(await bcrypt.compare(VALID_PASSWORD_PAYLOAD.password, user.password)).toBe(true);
            });

            it("should return 401 - invalid authorization token", async (): Promise<void> => {
                await registerValidUser();
                await request(app)
                    .post("/v1/account/password")
                    .set("authorization", "Bearer invalid_token")
                    .send(VALID_PASSWORD_PAYLOAD)
                    .expect(401);
                const user = await User.findOne({});
                expect(await bcrypt.compare(VALID_PASSWORD_PAYLOAD.password, user.password)).toBe(false);
            });

            it("should return 422 - invalid data", async (): Promise<void> => {
                const token = await registerValidUser();
                await request(app)
                    .post("/v1/account/password")
                    .set("authorization", `Bearer ${token}`)
                    .send(INVALID_PASSWORD_PAYLOAD)
                    .expect(422);
                const user = await User.findOne({});
                expect(await bcrypt.compare(VALID_PASSWORD_PAYLOAD.password, user.password)).toBe(false);
            });
        });

        describe("POST /delete", (): void => {
            beforeEach(async (): Promise<void> => initMongo());
            afterAll(async (): Promise<void> => disconnectMongo());

            it("should return 200 and delete the user", async (): Promise<void> => {
                const token = await registerValidUser();
                await request(app)
                    .post("/v1/account/delete")
                    .set("authorization", `Bearer ${token}`)
                    .expect(200);
                expect(await User.findOne()).toBeNull();
            });

            it("should return 401 - invalid authorization token", async (): Promise<void> => {
                await registerValidUser();
                await request(app)
                    .post("/v1/account/delete")
                    .expect(401);
                expect(await User.findOne()).toBeDefined();
            });
        });
    });
});