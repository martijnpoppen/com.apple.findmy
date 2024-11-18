import Homey from "homey";
import crypto from "crypto";

const algorithm = "aes-256-ctr";
const secretKey = Homey.env.SECRET;
const iv = crypto.randomBytes(16);

const sleep = async function (ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
};

const encrypt = function (text) {
    const secret = secretKey;
    const cipher = crypto.createCipheriv(algorithm, secret, iv);
    const encrypted = Buffer.concat([cipher.update(text), cipher.final()]);
    return `${iv.toString('hex')}+${encrypted.toString('hex')}`;
};

const decrypt = function (hash) {
    if(hash === null) {
         return hash;
    }

    const secret = secretKey;
    const splittedHash = hash.split('+');
    const decipher = crypto.createDecipheriv(algorithm, secret, Buffer.from(splittedHash[0], 'hex'));

    const decrpyted = Buffer.concat([decipher.update(Buffer.from(splittedHash[1], 'hex')), decipher.final()]);

    return decrpyted.toString();
};

const shortenString = function (str) {
    try {
        const decryptedString = decrypt(str);
        return crypto.createHash('sha256').update(decryptedString).digest('hex');
    } catch (error) {
        return str;
    }
}

export {
    decrypt,
    encrypt,
    shortenString,
    sleep
}