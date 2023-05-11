package com.blackat.chat.data.dao

import androidx.room.Dao
import androidx.room.Embedded
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.blackat.chat.data.model.Message
import com.blackat.chat.data.model.MessageState
import com.blackat.chat.data.model.PrivateConversation
import com.blackat.chat.data.model.PrivateMessage

@Dao
interface PrivateMessageDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(privateMessage: PrivateMessage)

    @Query("DELETE FROM private_message")
    suspend fun deleteAll()

    @Query(
            "SELECT private_message.*, private_conversation.e164 " +
                    "FROM private_conversation, private_message " +
                    "WHERE private_conversation.id = private_message.privateConversationId " +
                    "AND private_message.state = :messageState"
    )
    suspend fun getMessagesWithState(messageState: MessageState): List<MessageWithE164>
}

data class MessageWithE164(
        @Embedded
        val message: Message,
        val e164: String,
)