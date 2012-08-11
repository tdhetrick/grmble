var ScrollHandler = function() {
    var self = this;
    
    self.app = null;
    self.nearBottom = true;
    self.scrollRequests = 0;
    
    self.Bind = function( app ) {
        self.app = app;
        
        $( window ).scroll( function() {
            self.nearBottom = ( ( $( window ).scrollTop() + $( window ).height() ) > ( $( document ).height() - 80 ) );
        });
        
        self.app.events.addListener( 'message rendered', function() {
            self.ScrollToBottom();
        });
    }
    
    self.ScrollToBottom = function() {
        if ( self.nearBottom )
        {
            ++self.scrollRequests;
            if ( self.scrollRequests == 1 )
            {
                $( 'html, body' ).animate({ 
                        scrollTop: $( document ).height() - $( window ).height()
                    }, 
                    50,
                    "linear",
                    function() {
                        var outstandingRequests = self.scrollRequests > 1;
                        self.scrollRequests = 0;
                        if ( outstandingRequests )
                        {
                            self.ScrollToBottom();
                        }
                    }
                );
            }
        }
        else
        {
            function IndicateNewMessages() {
                if ( self.nearBottom )
                {
                    $( '#new-messages-indicator' ).addClass( 'hide' );
                    return;
                }
                
                $( '#new-messages-indicator' ).removeClass( 'hide' );
                $( '#new-messages-indicator' ).animate( { opacity: 0.2 }, 500, function() {
                    $( '#new-messages-indicator' ).animate( { opacity: 1.0 }, 500, function() {
                        IndicateNewMessages();
                    });
                });
            }
            
            IndicateNewMessages();
        }
    }
}