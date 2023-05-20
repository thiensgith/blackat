import { CountryCode } from "libphonenumber-js/types"
import { NativeEventEmitter, NativeModules } from "react-native"
import { App, Server, Signal } from "../../../shared/types"

const { AppModule } = NativeModules



interface AppModuleInterface {
    getConstants(): {
        // CURRENT_COUNTRY_CODE: CountryCode
    }
    test(): void,
    // testEvent(): void
    getConversationList(): Promise<Array<App.Types.Conversation>>
    isExistedConversation(e164: string): Promise<boolean>
    loadMessage(e164: string): Promise<App.Types.ConversationWithMessages>
    // saveMessage(conversationId: number, message: App.Types.MessageData): void
    saveMessage(e164: string, message: App.Types.MessageData, state: string): Promise<boolean>
    saveFileMessage(e164: string, message: App.Types.MessageData, state: string, fileInfo: Server.FileInfo): Promise<boolean>
    ting(e164: string): Promise<boolean>
    createConversation(e164: string, firstMessage: App.Types.MessageData): Promise<number>
    getSendingMessages(): Promise<Array<App.Types.MessageWithE164>>
    markAsSent(id: number): Promise<boolean>
    markAllPartnerMessageAsRead(conversationId: number): Promise<boolean>
    markAllPartnerMessageAsUnread(conversationId: number): Promise<boolean>
    getPartner(e164: string): Promise<App.Types.Partner | null>
    removeConversation(e164: string) : Promise<boolean>
}

export default AppModule as AppModuleInterface
