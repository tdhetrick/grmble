var faye = require( 'faye' );
var fayeRedis = require( 'faye-redis' );

var Messaging = function() {
    var self = this;

    self.app = null;
    self.bayeux = null;

    self.rooms = {};

    self.GetURLs = function( obj, request ) {
        return {
            'faye': 'http://' + ( ( request.headers.host.indexOf( ':' ) != -1 ) ? request.headers.host : ( request.headers.host + ':' + config.server.port ) ) + '/faye'
        };
    };
    
    self.postbind = function( app ) {
        self.app = app;

        self.bayeux = new faye.NodeAdapter({
            mount: '/faye',
            timeout: 45,
            engine: {
                type: fayeRedis,
                host: config.redis.host,
                port: config.redis.port,
                password: config.redis.password
            }
        });

        self.bayeux.attach( app );
        
        // we listen for joins/leaves across any of our servers so that all servers have full lists
        // of users in rooms
        //
        // TODO: figure out what to do with servers that have just come up
        //
        self.bayeux.getClient().subscribe( '/room/*', function( message ) {
            if ( message.kind == 'join' )
            {
                if ( !self.rooms[ message.roomId ] )
                {
                    self.rooms[ message.roomId ] = {};
                }
                
                self.rooms[ message.roomId ][ message.senderId ] = {
                    senderId: message.senderId,
                    nickname: message.nickname,
                    userHash: message.userHash,
                    avatar: message.avatar
                };
            }
            else if ( message.kind == 'leave' )
            {
                if ( self.rooms[ message.roomId ] )
                {
                    delete self.rooms[ message.roomId ][ message.senderId ];
                }
            }
        });
        
        // we listen only on the local server using 'bind' for handling logging and initial message emission
        //
        // if we were to subscribe, we'd end up trying to log the message from every app server and
        // emitting ( N * initial message count ) messages on the client channel where N is the number
        // of app servers
        self.bayeux.bind( 'publish', function( clientId, channel, message ) {
            if ( self.bayeux.getClient().getClientId() == clientId )
            {
                return;
            }
            
            models.Room.findById( message.roomId, function( error, room ) {
                if ( error )
                {
                    self.bayeux.getClient().publish( '/client/' + message.clientId, {
                        kind: 'error',
                        error: error
                    });
                    return;
                }
                
                if ( !room )
                {
                    self.bayeux.getClient().publish( '/client/' + message.clientId, {
                        kind: 'error',
                        error: 'No room found with id: ' + message.roomId
                    });
                    return;
                }
                
                if ( room.features.logs )
                {
                    var newMessage = new models.Message();
                    models.update( newMessage, message );
                    newMessage._id = message._id;
                    
                    newMessage.save( function( error ) {
                        if ( error )
                        {
                            log.channels.db.error( error );
                            self.bayeux.getClient().publish( '/client/' + message.clientId, {
                                kind: 'error',
                                errorobj: error,
                                error: 'message save failed',
                                message: 'Failed to save message into database.'
                            });
                            return;
                        }
                    });
                }
                    
                if ( message.kind == 'join' )
                {
                    if ( !self.rooms[ message.roomId ] )
                    {
                        self.rooms[ message.roomId ] = {};
                    }
                    
                    self.rooms[ message.roomId ][ message.senderId ] = {
                        senderId: message.senderId,
                        nickname: message.nickname,
                        userHash: message.userHash,
                        avatar: message.avatar
                    };
                    
                    var users = [];
                    for ( var id in self.rooms[ message.roomId ] )
                    {
                        users.push( self.rooms[ message.roomId ][ id ] );
                    }

                    self.bayeux.getClient().publish( '/client/' + message.clientId, {
                        kind: 'userlist',
                        roomId: message.roomId,
                        users: users
                    });
                    
                    // TODO: the performance on this will likely be terrible as rooms grow,
                    //       we really need a better way to get the last N messages and send
                    //       them to the client in the proper order
                    
                    // Send existing messages in room
                    var kinds = [ 'say' ]; //, 'join', 'leave' ];
                    models.Message.count( { roomId: room._id, kind: { $in: kinds } }, function( error, numMessages ) {
                        if ( error )
                        {
                            self.bayeux.getClient().publish( '/client/' + message.clientId, {
                                kind: 'error',
                                error: error
                            });
                            return;
                        }

                        var query = models.Message.find({
                            roomId: room._id,
                            kind: { $in: kinds }
                        });
                        
                        if ( numMessages > 100 )
                        {
                            query.skip( numMessages - 100 );
                        }

                        query.sort( 'createdAt' );
                        
                        var stream = query.stream();
                        
                        stream.on( 'data', function( storedMessage ) {
                            storedMessage = storedMessage.toObject();
                            storedMessage.createdAt = storedMessage.createdAt.toISOString();
                            storedMessage.updatedAt = storedMessage.updatedAt.toISOString();
                            self.bayeux.getClient().publish( '/client/' + message.clientId, storedMessage );
                        });
                        
                        stream.on( 'error', function( error ) {
                            self.bayeux.getClient().publish( '/client/' + message.clientId, {
                                kind: 'error',
                                error: error
                            });
                        });
                    });
                }
            });
        });
    }
}

module.exports = new Messaging();