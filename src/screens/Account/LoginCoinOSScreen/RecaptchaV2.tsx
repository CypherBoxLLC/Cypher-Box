import React, { useRef, useEffect } from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { WebView } from 'react-native-webview';

interface RecaptchaV2Props {
  siteKey: string;
  onToken: (token: string) => void;
  baseUrl?: string;
}

const RecaptchaV2: React.FC<RecaptchaV2Props> = ({ 
  siteKey, 
  onToken, 
  baseUrl = 'https://coinos.io' 
}) => {
  const webViewRef = useRef<WebView>(null);

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <script src="https://www.google.com/recaptcha/api.js?render=${siteKey}"></script>
        <style>
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          body {
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            background-color: #1a1a1a;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          }
          .container {
            text-align: center;
            padding: 20px;
          }
          h2 {
            color: #ffffff;
            margin-bottom: 20px;
            font-size: 18px;
          }
          .loading {
            color: rgba(214, 23, 161, 0.9);
            font-size: 16px;
            margin-top: 10px;
          }
          .spinner {
            border: 4px solid #333;
            border-top: 4px solid rgba(214, 23, 161, 0.9);
            border-radius: 50%;
            width: 40px;
            height: 40px;
            animation: spin 1s linear infinite;
            margin: 20px auto;
          }
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h2>Verifying...</h2>
          <div class="spinner"></div>
          <p class="loading">Please wait while we verify you're human</p>
        </div>
        <script>
          function onRecaptchaSuccess(token) {
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'success',
              token: token
            }));
          }

          function onRecaptchaError(error) {
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'error',
              message: error ? error.toString() : 'Captcha error occurred'
            }));
          }

          // Execute reCAPTCHA v3 automatically
          grecaptcha.ready(function() {
            try {
              grecaptcha.execute('${siteKey}', {action: 'login'})
                .then(function(token) {
                  onRecaptchaSuccess(token);
                })
                .catch(function(error) {
                  onRecaptchaError(error);
                });
            } catch (error) {
              onRecaptchaError(error);
            }
          });
        </script>
      </body>
    </html>
  `;

  const handleMessage = (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      
      if (data.type === 'success' && data.token) {
        console.log('Captcha token received successfully');
        onToken(data.token);
      } else if (data.type === 'error') {
        console.error('Captcha error:', data.message);
        // Still try to pass empty token to let server handle it
        onToken('');
      }
    } catch (e) {
      console.error('Error parsing captcha message:', e);
      onToken('');
    }
  };

  return (
    <View style={styles.container}>
      <WebView
        ref={webViewRef}
        originWhitelist={['*']}
        source={{ html, baseUrl }}
        onMessage={handleMessage}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        startInLoadingState={true}
        scalesPageToFit={true}
        mixedContentMode="always"
        thirdPartyCookiesEnabled={true}
        sharedCookiesEnabled={true}
        renderLoading={() => (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="rgba(214, 23, 161, 0.9)" />
          </View>
        )}
        onError={(syntheticEvent) => {
          const { nativeEvent } = syntheticEvent;
          console.error('WebView error: ', nativeEvent);
        }}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a1a',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
  },
});

export default RecaptchaV2;