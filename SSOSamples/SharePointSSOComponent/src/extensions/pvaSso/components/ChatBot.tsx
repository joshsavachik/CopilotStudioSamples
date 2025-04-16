import * as React from "react";
import { useBoolean, useId } from '@uifabric/react-hooks';
import * as ReactWebChat from 'botframework-webchat';
import { Dialog, DialogType } from 'office-ui-fabric-react/lib/Dialog';
import { DefaultButton } from 'office-ui-fabric-react/lib/Button';
import { Spinner } from 'office-ui-fabric-react/lib/Spinner';
import { Dispatch } from 'redux'
import { useRef } from "react";
import { AuthenticationResult } from "@azure/msal-browser";

import { IChatbotProps } from "./IChatBotProps";
import MSALWrapper from "./MSALWrapper";

export const PVAChatbotDialog: React.FunctionComponent<IChatbotProps> = (props) => {
    
    // Dialog properties and states
    const dialogContentProps = {
        type: DialogType.normal,
        title: props.botName,
        closeButtonAriaLabel: 'Close'
    };
    
    const [hideDialog, { toggle: toggleHideDialog }] = useBoolean(true);
    const labelId: string = useId('dialogLabel');
    const subTextId: string = useId('subTextLabel');
    
    const modalProps = React.useMemo(
        () => ({
            isBlocking: false,
        }),
        [labelId, subTextId],
    );

    // Your bot's token endpoint
    const botURL = props.botURL;

    // constructing URL using regional settings
    const environmentEndPoint = botURL.slice(0,botURL.indexOf('/powervirtualagents'));
    const apiVersion = botURL.slice(botURL.indexOf('api-version')).split('=')[1];
    const regionalChannelSettingsURL = `${environmentEndPoint}/powervirtualagents/regionalchannelsettings?api-version=${apiVersion}`;

    // Using refs instead of IDs to get the webchat and loading spinner elements
    const webChatRef = useRef<HTMLDivElement>(null);
    const loadingSpinnerRef = useRef<HTMLDivElement>(null);

    // A utility function that extracts the OAuthCard resource URI from the incoming activity or return undefined
    function getOAuthCardResourceUri(activity: any): string | undefined {
        const attachment = activity?.attachments?.[0];
        if (attachment?.contentType === 'application/vnd.microsoft.card.oauth' && attachment.content.tokenExchangeResource) {
            return attachment.content.tokenExchangeResource.uri;
        }
    }

    const handleLayerDidMount = async () => {
        
        // Use the passed MSALWrapper instance or create one if not provided (should not happen)
        const MSALWrapperInstance = props.msalWrapperInstance || new MSALWrapper(props.clientID, props.authority);

        // --- Redirect Handling --- 
        // Call handleRedirectPromise FIRST to process any authentication response hash in the URL.
        // This needs to run *before* any token acquisition attempts.
        let authResultFromRedirect: AuthenticationResult | null = null;
        try {
             authResultFromRedirect = await MSALWrapperInstance.handleRedirectPromise();
             if (authResultFromRedirect) {
                 console.log('Chatbot: Successfully processed redirect response.');
                 // If handleRedirectPromise processed a token, we might not need to acquire another one immediately.
                 // The underlying MSAL instance now has the account info and tokens in cache.
             } else {
                 console.log('Chatbot: No redirect response to process.');
             }
        } catch (error) {
            // Log the error but continue, as the page might still load if a cached token exists.
            console.error('Chatbot: Error during handleRedirectPromise:', error);
        }
        // --- End Redirect Handling ---

        // Now, attempt to get a token for the bot.
        let finalAuthResult: AuthenticationResult | null = authResultFromRedirect; // Use redirect token if available

        // If redirect didn't provide a token, try to get one silently for an existing user.
        if (!finalAuthResult) {
            console.log('Chatbot: Redirect did not provide token, attempting silent acquisition for logged in user...');
            finalAuthResult = await MSALWrapperInstance.handleLoggedInUser([props.customScope], props.userEmail);
        }

        // If still no token (no redirect response, no logged-in user with cached token), 
        // attempt the full acquireAccessToken flow (silent -> interactive redirect).
        if (!finalAuthResult) {
            console.log('Chatbot: No token from redirect or logged-in user, initiating acquireAccessToken flow...');
            // acquireAccessToken will handle the loginRedirect if necessary.
            // We expect null here if acquireAccessToken initiates a redirect.
            finalAuthResult = await MSALWrapperInstance.acquireAccessToken([props.customScope], props.userEmail);
        }

        // Proceed only if we have a final token (either from redirect or acquisition)
        const token = finalAuthResult?.accessToken || null;
        if (!token) {
            console.warn('Chatbot: Could not acquire token after all attempts. Webchat might not function correctly.');
            // Optionally hide spinner or show an error message
            if (loadingSpinnerRef.current) loadingSpinnerRef.current.style.display = 'none';
            // Consider adding a user-facing message here
            return; // Stop execution if no token
        }
        
        console.log('Chatbot: Successfully obtained token, proceeding to render webchat.');

        // Get the regional channel URL
        let regionalChannelURL;

        const regionalResponse = await fetch(regionalChannelSettingsURL);
        if(regionalResponse.ok){
            const data = await regionalResponse.json();
            regionalChannelURL = data.channelUrlsById.directline;
        }
        else {
            console.error(`HTTP error! Status: ${regionalResponse.status}`);
        }


        // Create DirectLine object
        let directline: any;

        const response = await fetch(botURL);
        
        if (response.ok) {
            const conversationInfo = await response.json();
            directline = ReactWebChat.createDirectLine({
            token: conversationInfo.token,
            domain: regionalChannelURL + 'v3/directline',
        });
        } else {
        console.error(`HTTP error! Status: ${response.status}`);
        }

        const store = ReactWebChat.createStore(
            {},
               ({ dispatch }: { dispatch: Dispatch }) => (next: any) => (action: any) => {
                   
                // Checking whether we should greet the user
                if (props.greet)
                {
                    if (action.type === "DIRECT_LINE/CONNECT_FULFILLED") {
                        console.log("Action:" + action.type); 
                            dispatch({
                                meta: {
                                    method: "keyboard",
                                  },
                                    payload: {
                                      activity: {
                                              channelData: {
                                                  postBack: true,
                                              },
                                              //Web Chat will show the 'Greeting' System Topic message which has a trigger-phrase 'hello'
                                              name: 'startConversation',
                                              type: "event"
                                          },
                                  },
                                  type: "DIRECT_LINE/POST_ACTIVITY",
                              });
                              return next(action);
                          }
                    }
                    
                    // Checking whether the bot is asking for authentication
                    if (action.type === "DIRECT_LINE/INCOMING_ACTIVITY") {
                        const activity = action.payload.activity;
                        if (activity.from && activity.from.role === 'bot' &&
                        (getOAuthCardResourceUri(activity))){
                          // Check if token is valid before proceeding
                          if (token) {
                            directline.postActivity({
                              type: 'invoke',
                              name: 'signin/tokenExchange',
                              value: {
                                id: activity.attachments[0].content.tokenExchangeResource.id,
                                connectionName: activity.attachments[0].content.connectionName,
                                token
                              },
                              "from": {
                                id: props.userEmail,
                                name: props.userFriendlyName,
                                role: "user"
                              }
                            }).subscribe(
                                (id: any) => {
                                  if(id === "retry"){
                                    // bot was not able to handle the invoke, so display the oauthCard (manual authentication)
                                    console.log("bot was not able to handle the invoke, so display the oauthCard")
                                        return next(action);
                                  }
                                },
                                (error: any) => {
                                  // an error occurred to display the oauthCard (manual authentication)
                                  console.log("An error occurred so display the oauthCard");
                                      return next(action);
                                }
                              )
                              // token exchange was successful, do not show OAuthCard
                              return;
                          }
                        }
                      } else {
                        return next(action);
                      }
                    
                    return next(action);
                }
            );

            // hide the upload button - other style options can be added here
            const canvasStyleOptions = {
                hideUploadButton: true
            }
        
            // Render webchat
            if (token && directline) {
                if (webChatRef.current && loadingSpinnerRef.current) {
                    webChatRef.current.style.minHeight = '50vh';
                    loadingSpinnerRef.current.style.display = 'none';
                    ReactWebChat.renderWebChat(
                        {
                            directLine: directline,
                            store: store,
                            styleOptions: canvasStyleOptions,
                            userID: props.userEmail,
                        },
                    webChatRef.current
                    );
                } else {
                    console.error("Webchat or loading spinner not found");
                }
        }

    };

    return (
        <>
            <DefaultButton 
                secondaryText={props.buttonLabel} 
                text={props.buttonLabel} 
                onClick={toggleHideDialog}
                styles={{
                    root: {
                        backgroundColor: '#d9222a',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        boxShadow: '0 4px 8px rgba(255, 0, 0, 0.5)',
                        position: 'fixed',
                        bottom: '20px',
                        right: '20px',
                        zIndex: 1000
                    },
                    rootHovered: {
                        backgroundColor: '#b71d25',
                        color: 'white'
                    }
                }}
            />
            <Dialog styles={{
                main: { selectors: { ['@media (min-width: 480px)']: { width: 450, minWidth: 450, maxWidth: '1000px' } } }
            }} hidden={hideDialog} onDismiss={toggleHideDialog} onLayerDidMount={handleLayerDidMount} dialogContentProps={dialogContentProps} modalProps={modalProps}>
                <div id="chatContainer" style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                    <div ref={webChatRef} role="main" style={{ width: "100%", height: "0rem" }}></div>
                    <div ref={loadingSpinnerRef}><Spinner label="Loading..." style={{ paddingTop: "1rem", paddingBottom: "1rem" }} /></div>
                </div>
            </Dialog>
            
        </>
    );
};

export default class Chatbot extends React.Component<IChatbotProps> {
    constructor(props: IChatbotProps) {
        super(props);
    }
    public render(): JSX.Element {
        return (
            <div style={{ 
                display: "flex", 
                flexDirection: "column", 
                alignItems: "center", 
                paddingBottom: "1rem",
                backgroundColor: "transparent" 
            }}>
                <PVAChatbotDialog
                {...this.props}/>
            </div>
        );
    }
}  