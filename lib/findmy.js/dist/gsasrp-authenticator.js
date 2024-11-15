var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { Hash, Mode, Srp, util } from '@foxt/js-srp';
import crypto from 'crypto';
import { base64ToU8Array, stringToU8Array } from './utils.js';
const srp = new Srp(Mode.GSA, Hash.SHA256, 2048);
export class GSASRPAuthenticator {
    constructor(username) {
        this.username = username;
        this.srpClient = undefined;
    }
    derivePassword(protocol, password, salt, iterations) {
        return __awaiter(this, void 0, void 0, function* () {
            let passHash = new Uint8Array(yield util.hash(srp.h, stringToU8Array(password)));
            if (protocol == 's2k_fo')
                passHash = stringToU8Array(util.toHex(passHash));
            const imported = yield crypto.subtle.importKey('raw', passHash, { name: 'PBKDF2' }, false, ['deriveBits']);
            const derived = yield crypto.subtle.deriveBits({
                name: 'PBKDF2',
                hash: { name: 'SHA-256' },
                iterations,
                salt,
            }, imported, 256);
            return new Uint8Array(derived);
        });
    }
    getInit() {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.srpClient)
                throw new Error('Already initialized');
            this.srpClient = yield srp.newClient(stringToU8Array(this.username), 
            // provide fake passsword because we need to get data from server
            new Uint8Array());
            const a = Buffer.from(util.bytesFromBigint(this.srpClient.A)).toString('base64');
            return {
                a,
                protocols: ['s2k', 's2k_fo'],
                accountName: this.username,
            };
        });
    }
    getComplete(password, serverData) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.srpClient)
                throw new Error('Not initialized');
            const salt = base64ToU8Array(serverData.salt);
            const serverPub = base64ToU8Array(serverData.b);
            const iterations = serverData.iteration;
            const derived = yield this.derivePassword(serverData.protocol, password, salt, iterations);
            this.srpClient.p = derived;
            yield this.srpClient.generate(salt, serverPub);
            const m1 = Buffer.from(this.srpClient._M).toString('base64');
            const M2 = yield this.srpClient.generateM2();
            const m2 = Buffer.from(M2).toString('base64');
            return {
                accountName: this.username,
                m1,
                m2,
                c: serverData.c,
            };
        });
    }
}
//# sourceMappingURL=gsasrp-authenticator.js.map