import { formatISO } from "date-fns";
import { App, BundleRequirement, Server, Signal, SignalError, SocketEvent } from "../../shared/types";
import SignalModule from "../native/android/SignalModule";
import Log from "./Log";
import socket from "./socket";
import AppModule from "../native/android/AppModule";
import { BackHandler } from "react-native";

// ===================== ONLINE HANDLE

const emitCheckMailBox = () => {
    return new Promise<Array<Server.Mail>>((resolve) => {
        socket.emit('checkMailbox', function (messages) {
            resolve(messages)
        })
    })
}

export const prepareMessaging = async () => {
    const mailbox = await emitCheckMailBox()
    await mailboxHandler(mailbox)
    const sendingMessage = await AppModule.getSendingMessages();
    const localAddress = await SignalModule.requireLocalAddress()
    for (let i = 0; i < sendingMessage.length; i++) {
        const v = sendingMessage[i];
        await encryptAndSendMessage(localAddress, v.e164, v.message, v.fileInfo)
    }
}

// ===================== SIGNAL PROTOCOL

const emitUploadIdentityKey = (identityKey: Signal.Types.IdentityKey) => {
    return new Promise<boolean>((resolve) => {
        socket.emit('uploadIdentityKey', identityKey, function (result) {
            resolve(result)
        })
    })
}



const emitUploadSignedPreKey = (signedPreKey: Signal.Types.SignedPreKey) => {
    return new Promise<boolean>((resolve) => {
        socket.emit('uploadSignedPreKey', signedPreKey, function (result) {
            resolve(result)
        })
    })
}

const emitUploadPreKeys = (preKeys: Array<Signal.Types.PreKey>) => {
    return new Promise<boolean>((resolve) => {
        socket.emit('uploadPreKeys', preKeys, function (result) {
            resolve(result)
        })
    })
}

const handleBundleRequire = async (requirement: BundleRequirement): Promise<boolean> => {
    try {
        let resultIdentityKey = true;
        let resultSignedPreKey = true;
        let resultPreKey = true;
        if (requirement.needIdentityKey) {
            const identityKey = await SignalModule.requireIdentityKey()
            resultIdentityKey = await emitUploadIdentityKey(identityKey)
        }
        if (requirement.needSignedPreKey) {
            const signedPreKey = await SignalModule.requireSignedPreKey()
            resultSignedPreKey = await emitUploadSignedPreKey(signedPreKey)
        }
        if (requirement.needPreKeys) {
            const preKeys = await SignalModule.requireOneTimePreKey()
            resultPreKey = await emitUploadPreKeys(preKeys)
        }
        return resultIdentityKey && resultPreKey && resultSignedPreKey
    } catch (e) {
        console.log(e)
        return false
    }

}

export const onBundleRequire = (requirement: BundleRequirement) => {
    if (requirement.needIdentityKey || requirement.needPreKeys || requirement.needSignedPreKey)
        //   ToastAndroid.show("Máy chủ thiếu một só khóa và yêu cầu cung cấp khóa chúng", ToastAndroid.SHORT)
        handleBundleRequire(requirement).then((v) => {

            if (!v) {
                // ToastAndroid.show("Cung cấp khóa cho máy chủ không thành công", ToastAndroid.SHORT)
                BackHandler.exitApp()
            }
            //   else ToastAndroid.show("Cung cấp khóa cho máy chủ thành công", ToastAndroid.SHORT)
        })
}

export const getPreKeyBundle = async (address: Signal.Types.SignalProtocolAddress): Promise<Signal.Types.PreKeyBundle> => new Promise((resolve, reject) => {
    socket.emit('getPreKeyBundle', address, (preKeyBundle) => {
        if (preKeyBundle === null) reject(new Error('not-found-key'))
        resolve(preKeyBundle)
    })
})

export const getAddresses = async (e164: string): Promise<Array<Signal.Types.SignalProtocolAddress>> => new Promise((resolve, reject) => {
    socket.emit('getAddresses', e164, (addresses) => {
        resolve(addresses)
    })
})

const syncSession = async function (e164: string) {
    const addresses = await getAddresses(e164)
    const missingSession = await SignalModule.missingSession(addresses)
    for (let index = 0; index < missingSession.length; index++) {
        const missing = missingSession[index];
        const preKeyBundle = await getPreKeyBundle(missing)
        const perform = await SignalModule.performKeyBundle(e164, preKeyBundle)
        console.log("performKeyBundle[" + preKeyBundle.deviceId + "]: " + perform)
        if (!perform) console.log(preKeyBundle)
    }
    return addresses
}

// ====================== MESSAGING

export const outGoingMessage = async (
    sender: Signal.Types.SignalProtocolAddress,
    address: Signal.Types.SignalProtocolAddress,
    message: Server.Message): Promise<SocketEvent.OutGoingMessageResult> => new Promise((resolve, reject) => {
        socket.emit('outGoingMessage', sender, address, message, (v) => {
            resolve(v)
        })
    })

export const inComingMessage = (sender: Signal.Types.SignalProtocolAddress, message: Server.Message, callback: (inComingMessageResult: SocketEvent.InComingMessageResult) => void) => {
    Log(`Có tin nhắn mới từ ${sender.e164}`)
    Log(message)
    receiveAndDecryptMessage(sender, message).then((messageData) => {
        if (messageData !== null) {
            saveMessageToLocal(sender.e164, messageData, App.MessageState.UNKNOWN)
        }
        callback({
            isProcessed: true
        })
    }).catch((e) => {
        console.log("Bắt đc nè")
        console.log(e)
        callback({
            isProcessed: false
        })
    })
}

export const saveMessageToLocal = async (e164: string, message: App.Types.MessageData, state: string, fileInfo?: Server.FileInfo) => {
    try {
        if (fileInfo !== undefined)
            await AppModule.saveMessage(e164, message, state, fileInfo)
        else
            await AppModule.saveMessage(e164, message, state)
    }
    catch (e) { console.log(e) }
}

export const receiveAndDecryptMessage = async (sender: Signal.Types.SignalProtocolAddress, message: Server.Message): Promise<App.Types.MessageData | null> => {
    try {
        let plainText
        if (message.fileInfo !== undefined) {
            console.log("Nhan dc anh dang decrypt")
            plainText = await SignalModule.decryptFile(sender, message.data, message.fileInfo, false)
        }
        else
            plainText = await SignalModule.decrypt(sender, message.data, false)
        if (plainText === null) {
            Log("GHI FILE THẤT BẠI")
            // ToastAndroid.show('GHI FILE THẤT BẠI', ToastAndroid.SHORT)
            throw new Error("GHI FILE THAT BAI")
        }
        if (typeof plainText !== "string") {
            const error = (plainText as SignalError)
            if (error.code == "need-encrypt") {
                const localAddress = await SignalModule.requireLocalAddress()
                const emptyCipher = await SignalModule.encrypt(sender, "")
                const emptyMessage: Server.Message = {
                    data: {
                        cipher: emptyCipher.cipher,
                        type: emptyCipher.type
                    },
                    type: App.MessageType.EMPTY,
                    timestamp: formatISO(new Date())
                }

                const result = await outGoingMessage(localAddress, sender, emptyMessage)
                if (message.fileInfo !== undefined) {
                    plainText = await SignalModule.decryptFile(sender, message.data, message.fileInfo, true)
                }
                else
                    plainText = await SignalModule.decrypt(sender, message.data, true)
                if (typeof plainText !== "string") throw new Error("cannot-encrypt")
            }
        }
        if (message.type == App.MessageType.EMPTY) return null;
        const decryptedMessage: App.Types.MessageData = {
            data: plainText as string,
            owner: App.MessageOwner.PARTNER,
            timestamp: message.timestamp,
            type: message.type
        }
        return decryptedMessage
        // saveMessageToLocal(sender.e164,decryptedMessage)
    } catch (e) {
        console.log(e)
        if (e instanceof Error)
            throw e
        else return null
    }
}

export const encryptAndSendMessage = async function (
    localAddress: Signal.Types.SignalProtocolAddress,
    e164: string, message: App.Types.MessageData, fileInfo?: Server.FileInfo): Promise<boolean> {
    // console.log("startSendMessageToServer")
    const addresses = await syncSession(e164)
    let result = false
    for (let index = 0; index < addresses.length; index++) {
        const address = addresses[index];
        let cipher
        if (fileInfo !== undefined) {
            cipher = await SignalModule.encryptFile(address, message.data)
        }
        else {
            cipher = await SignalModule.encrypt(address, message.data)
        }
        const cipherMessage: Server.Message = {
            data: cipher,
            type: message.type,
            timestamp: message.timestamp,
            fileInfo: fileInfo
        }

        const outGoingMessageResult = await outGoingMessage(localAddress, address, cipherMessage)
        console.log(outGoingMessageResult)
        // console.log("sendResult[" + address.deviceId + "]: " + result)
        if (outGoingMessageResult.sentAt !== SocketEvent.SendAt.FAILED) {
            result = true
        }
    }
    return result

}

const findErrorMails = async (messages: Array<Server.Mail>): Promise<Array<Server.Mail>> => {
    var errorMessage: Array<Server.Mail> = []
    console.log("Có " + messages.length + " mail cần check")
    for (let message of messages) {
        try {
            console.log("Đang check " + message.sender.e164)
            const msgData = await receiveAndDecryptMessage(message.sender, message.message)
            if (msgData !== null) {
                saveMessageToLocal(message.sender.e164, msgData, App.MessageState.UNKNOWN)
                AppModule.ting(message.sender.e164)
            }

        } catch (e) {
            errorMessage.push(message)
        }
    }
    return errorMessage
}

export const mailboxHandler = async (messages: Array<Server.Mail>): Promise<void> => {
    const errors = await findErrorMails(messages)

    console.log("Đã check mail với " + errors.length + " mail bị lỗi")
    if (errors.length > 0) {
        console.log("Các mail xử lí thất bại")
        console.log(errors)
    }

    return;

}