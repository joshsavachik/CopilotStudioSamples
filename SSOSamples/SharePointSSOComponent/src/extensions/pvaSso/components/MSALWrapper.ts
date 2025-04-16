// MSALWrapper.ts
import { PublicClientApplication, AuthenticationResult, 
    Configuration, LogLevel, BrowserCacheLocation} from "@azure/msal-browser";

// Determine the base SharePoint site URL to use for homepage detection
const baseSharePointSiteUrl = window.location.href.split('/sites/')[0] + '/sites/AI-Innovation/';
console.log('Base SharePoint site URL for redirects:', baseSharePointSiteUrl);

// // Function to properly detect if we're on the homepage - NO LONGER USED
// function isActualHomePage(): boolean {
//   const url = window.location.href;
//   // The actual home page should end with /sites/AI-Innovation/ or /sites/AI-Innovation/SitePages/Home.aspx
//   // or have only a trailing hash or query params after those paths
  
//   const isBase = url === baseSharePointSiteUrl || 
//     url === baseSharePointSiteUrl.slice(0, -1) || // Without trailing slash
//     url.match(/\/sites\/AI-Innovation\/(\?|#|$)/) !== null;
    
//   const isHomePage = isBase || 
//     url.match(/\/sites\/AI-Innovation\/SitePages\/Home\.aspx(\?|#|$)/) !== null;
    
//   console.log('URL check for homepage:', url, isHomePage);
//   return isHomePage;
// }

// Function to safely access localStorage/sessionStorage
export const safeStorage = {
  getItem: (key: string): string | null => {
    try {
      // Try localStorage first
      const value = localStorage.getItem(key);
      if (value !== null) return value;
      
      // Fall back to sessionStorage if localStorage failed or returned null
      return sessionStorage.getItem(key);
    } catch (e) {
      console.warn('Storage access failed:', e);
      return null;
    }
  },
  setItem: (key: string, value: string): void => {
    try {
      // Try to set in both storage types for maximum compatibility
      try { localStorage.setItem(key, value); } catch (e) { console.warn('localStorage set failed'); }
      try { sessionStorage.setItem(key, value); } catch (e) { console.warn('sessionStorage set failed'); }
    } catch (e) {
      console.warn('All storage access failed:', e);
    }
  },
  removeItem: (key: string): void => {
    try {
      try { localStorage.removeItem(key); } catch (e) { console.warn('localStorage remove failed'); }
      try { sessionStorage.removeItem(key); } catch (e) { console.warn('sessionStorage remove failed'); }
    } catch (e) {
      console.warn('All storage removal failed:', e);
    }
  }
};

// // Remove the immediate execution code that checked for redirects prematurely
// (function() {
//   try {
//     // Use more specific detection for homepage
//     const isHomePage = isActualHomePage();
//     const originalUrl = safeStorage.getItem('msalOriginalUrl');
    
//     console.log('IMMEDIATE EXEC - Current URL:', window.location.href);
//     console.log('IMMEDIATE EXEC - Is homepage:', isHomePage);
//     console.log('IMMEDIATE EXEC - Original URL from storage:', originalUrl);
    
//     // Simplified condition: Redirect if on homepage, originalUrl exists, and it's not the homepage itself.
//     if (isHomePage && originalUrl && originalUrl !== window.location.href) { 
//       console.log('Immediate redirect from home page to:', originalUrl);
      
//       // Clear the saved URL to prevent redirect loops
//       safeStorage.removeItem('msalOriginalUrl');
      
//       // Use a slightly longer timeout for the redirect
//       setTimeout(() => {
//         window.location.href = originalUrl;
//       }, 300);
//     }
//   } catch (e) {
//     console.error('Error in immediate redirect check:', e);
//   }
// })();

export class MSALWrapper {
  private msalConfig: Configuration;
  private msalInstance: PublicClientApplication;
  private redirectUri: string;

  constructor(clientId: string, authority: string) {
    // Determine if we're on the homepage using the more accurate check
    // const isHomePage = isActualHomePage(); // No longer needed here
    
    // // Remove the logic that stored URL on initialization
    // if (!isHomePage) {
    //   console.log('Storing URL on MSAL initialization:', window.location.href);
    //   safeStorage.setItem('msalOriginalUrl', window.location.href);
    // } else {
    //   console.log('Not storing URL because we are on homepage');
    // }

    // Use the base SharePoint site URL as the redirect URI
    this.redirectUri = baseSharePointSiteUrl;
    console.log('Using redirect URI:', this.redirectUri);

    // Determine the best cache location based on browser capabilities
    let cacheLocation: BrowserCacheLocation = BrowserCacheLocation.LocalStorage;
    
    // Test if localStorage is accessible
    try {
      localStorage.setItem('msalTest', 'test');
      localStorage.removeItem('msalTest');
    } catch (e) {
      // If localStorage fails, use sessionStorage
      console.log('localStorage not available, falling back to sessionStorage');
      cacheLocation = BrowserCacheLocation.SessionStorage;
      
      // Also test sessionStorage
      try {
        sessionStorage.setItem('msalTest', 'test');
        sessionStorage.removeItem('msalTest');
      } catch (e) {
        // If both fail, use memory storage as last resort
        console.log('sessionStorage not available either, falling back to memory storage');
        cacheLocation = BrowserCacheLocation.MemoryStorage;
      }
    }
    
    console.log('Using MSAL cache location:', cacheLocation);

    this.msalConfig = {
      auth: {
        clientId: clientId,
        authority: authority,
        redirectUri: this.redirectUri,
        navigateToLoginRequestUrl: false,
        postLogoutRedirectUri: this.redirectUri,
      },
      cache: {
        cacheLocation: cacheLocation,
        storeAuthStateInCookie: true, // Enable cookies as fallback for storage
      },
      system: {
        allowRedirectInIframe: false,
        iframeHashTimeout: 10000,
        loggerOptions: {
          loggerCallback: (level, message, containsPii) => {
            if (containsPii) {
              return;
            }
            switch (level) {
              case LogLevel.Error:
                console.error('MSAL:', message);
                return;
              case LogLevel.Info:
                console.info('MSAL:', message);
                return;
              case LogLevel.Verbose:
                console.debug('MSAL:', message);
                return;
              case LogLevel.Warning:
                console.warn('MSAL:', message);
                return;
              default:
                return;
            }
          }
        }
      }
    };

    this.msalInstance = new PublicClientApplication(this.msalConfig);
  }

  public async handleLoggedInUser(scopes: string[], userEmail: string): Promise<AuthenticationResult | null> {
    let userAccount = null;
    const accounts = this.msalInstance.getAllAccounts();
    
    if(accounts === null || accounts.length === 0) {
      console.log("No users are signed in");
      return null;
    } else if (accounts.length > 1) {
        userAccount = this.msalInstance.getAccountByUsername(userEmail);
    } else {
        userAccount = accounts[0];
    }

    if(userAccount !== null) {
        const accessTokenRequest = {
            scopes: scopes,
            account: userAccount
        };

        try {
            return await this.msalInstance.acquireTokenSilent(accessTokenRequest);
        } catch (error) {
            console.log("Silent token acquisition failed:", error);
            return null;
        }
    }
    return null;
  }
  
  public async acquireAccessToken(scopes: string[], userEmail: string): Promise<AuthenticationResult | null> {
    // Determine if we're on the homepage using the more accurate check
    // const isHomePage = isActualHomePage(); // No longer needed here
    
    // // Remove the logic that stored URL before auth, move it below
    // if (!isHomePage) {
    //   console.log('Storing URL before auth:', window.location.href);
    //   safeStorage.setItem('msalOriginalUrl', window.location.href);
    // }
    
    // Request for interactive login (can include prompt)
    const interactiveRequest = {
        scopes: scopes,
        loginHint: userEmail,
        prompt: "select_account"
    };

    // Request for silent acquisition (MUST NOT include prompt other than 'none')
    const silentRequest = {
        scopes: scopes,
        loginHint: userEmail,
        // prompt: 'none' // Can be omitted, default is 'none'
    };

    try {
        // Try to get token from cache first using silent request
        const accounts = this.msalInstance.getAllAccounts();
        if (accounts.length > 0) {
            // Prefer using getAccountByUsername if multiple accounts or specific user is needed
            const account = accounts.length > 1 ? this.msalInstance.getAccountByUsername(userEmail) : accounts[0];
            if (account) {
                try {
                    console.log('Attempting silent token acquisition...');
                    return await this.msalInstance.acquireTokenSilent({
                        ...silentRequest, // Use the silent request config
                        account: account
                    });
                } catch (error) {
                    // Log specific silent errors, especially InteractionRequiredAuthError
                    console.log("Silent token acquisition failed, likely requires interaction:", error);
                    // Do NOT return null here, proceed to interactive login
                }
            } else {
                console.log('Account matching loginHint not found, proceeding to interactive login.');
            }
        } else {
            console.log('No accounts found, proceeding to interactive login.');
        }

        // If silent acquisition fails or no accounts, proceed to interactive login
        console.log('Storing URL before initiating login redirect:', window.location.href);
        safeStorage.setItem('msalOriginalUrl', window.location.href);
        // Use the interactive request for redirect
        await this.msalInstance.loginRedirect(interactiveRequest); 
        return null; // loginRedirect will handle the flow, return null for now
    } catch (error) {
        // Catch errors during the redirect initiation itself
        console.log("Login redirect initiation failed:", error);
        return null;
    }
  }

  // Add method to handle redirect response
  public async handleRedirectPromise(): Promise<AuthenticationResult | null> {
    try {
        // Log current state for debugging
        console.log('MSALWrapper.handleRedirectPromise - Current URL:', window.location.href);
        
        // Only process the token response, let the global handler manage redirects
        const response = await this.msalInstance.handleRedirectPromise();
        if (response) {
            console.log('Authentication successful, token acquired:', response.uniqueId);
        }
        
        return response;
    } catch (error) {
        console.log("Handle redirect promise failed:", error);
        return null;
    }
  }

  // Add a helper function to get the redirect URI
  public getRedirectUri(): string {
    return this.redirectUri;
  }
}

export default MSALWrapper;