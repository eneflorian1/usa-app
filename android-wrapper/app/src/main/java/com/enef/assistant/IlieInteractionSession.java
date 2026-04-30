package com.enef.assistant;

import android.content.Context;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.service.voice.VoiceInteractionSession;

public class IlieInteractionSession extends VoiceInteractionSession {
    private WebView mWebView;

    public IlieInteractionSession(Context context) {
        super(context);
    }

    @Override
    public View onCreateContentView() {
        FrameLayout root = new FrameLayout(getContext());
        mWebView = new WebView(getContext());
        
        // Configurare WebView pentru performanță și permisiuni audio
        WebSettings settings = mWebView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        
        mWebView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                // Acordă automat permisiunea de microfon site-ului tău
                request.grant(request.getResources());
            }
        });

        mWebView.setWebViewClient(new WebViewClient());
        
        // Încarcă interfața de asistent a site-ului tău
        // Folosim o query param pentru a porni automat vocea în interfață dacă e nevoie
        mWebView.loadUrl("https://enef.site/orchestrator?mode=assistant&autostart=true");

        root.addView(mWebView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 
                ViewGroup.LayoutParams.MATCH_PARENT));
        
        return root;
    }
}
