import { OnboardingModes } from "core/protocol/core";
import { useContext, useEffect, useRef } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import styled from "styled-components";
import { CustomScrollbarDiv } from ".";
import { AuthProvider } from "../context/Auth";
import { IdeMessengerContext } from "../context/IdeMessenger";
import { LocalStorageProvider } from "../context/LocalStorage";
import { useWebviewListener } from "../hooks/useWebviewListener";
import { useAppDispatch, useAppSelector } from "../redux/hooks";
import { setCodeToEdit } from "../redux/slices/editState";
import { setShowDialog } from "../redux/slices/uiSlice";
import { enterEdit, exitEdit } from "../redux/thunks/edit";
import { saveCurrentSession } from "../redux/thunks/session";
import { openNewChatTab } from "../redux/thunks/switchChatSession";
import {
  saveMainEditorDraft,
  restoreMainEditorDraft,
} from "../util/mainEditorDraft";
import { fontSize, isMetaEquivalentKeyPressed } from "../util";
import { CONFIG_ROUTES, ROUTES } from "../util/navigation";
import { FatalErrorIndicator } from "./config/FatalErrorNotice";
import TextDialog from "./dialogs";
import { useMainEditor } from "./mainInput/TipTapEditor";
import { isNewUserOnboarding, useOnboardingCard } from "./OnboardingCard";
import {
  shouldShowOnboardingCard,
  API_KEYS_FROM_ENV,
} from "./OnboardingCard/utils";
import OSRContextMenu from "./OSRContextMenu";
import { ChatPanelTitleActions } from "./ChatPanelTitleActions";

const LayoutTopDiv = styled(CustomScrollbarDiv)`
  height: 100%;
  position: relative;
  overflow-x: hidden;
`;

const GridDiv = styled.div`
  display: grid;
  grid-template-rows: 1fr auto;
  height: 100vh;
  width: 100%;
  min-width: 0;
  max-width: 100%;
  overflow-x: hidden;
`;

const Layout = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useAppDispatch();
  const onboardingCard = useOnboardingCard();
  const config = useAppSelector((state) => state.config.config);
  const configLoading = useAppSelector((state) => state.config.loading);
  const ideMessenger = useContext(IdeMessengerContext);

  const { mainEditor } = useMainEditor();
  const dialogMessage = useAppSelector((state) => state.ui.dialogMessage);

  const showDialog = useAppSelector((state) => state.ui.showDialog);
  const isInEdit = useAppSelector((store) => store.session.isInEdit);
  const showSessionTabs = useAppSelector(
    (store) => store.config.config.ui?.showSessionTabs ?? true,
  );
  const isHome =
    location.pathname === ROUTES.HOME ||
    location.pathname === ROUTES.HOME_INDEX;
  const mainEditorDraftContent = useAppSelector(
    (state) => state.session.mainEditorDraftContent,
  );
  const prevIsHomeRef = useRef(isHome);

  useEffect(() => {
    const wasHome = prevIsHomeRef.current;
    if (wasHome && !isHome) {
      saveMainEditorDraft(dispatch, mainEditor);
    } else if (!wasHome && isHome) {
      restoreMainEditorDraft(mainEditor, mainEditorDraftContent);
    }
    prevIsHomeRef.current = isHome;
  }, [isHome, mainEditor, mainEditorDraftContent, dispatch]);

  useWebviewListener(
    "newSession",
    async () => {
      navigate(ROUTES.HOME);
      if (isInEdit) {
        void dispatch(exitEdit({ openNewSession: true }));
      } else if (showSessionTabs) {
        void dispatch(openNewChatTab());
      } else {
        // Returns immediately after switching to empty chat; prior session saves in background
        void dispatch(
          saveCurrentSession({
            openNewSession: true,
            generateTitle: true,
          }),
        );
      }
    },
    [isInEdit, showSessionTabs, dispatch],
  );

  useWebviewListener(
    "isContinueInputFocused",
    async () => {
      return false;
    },
    [isHome],
    isHome,
  );

  useWebviewListener(
    "focusContinueInputWithNewSession",
    async () => {
      navigate(ROUTES.HOME);
      if (isInEdit) {
        void dispatch(
          exitEdit({
            openNewSession: true,
          }),
        );
      } else {
        void dispatch(
          saveCurrentSession({
            openNewSession: true,
            generateTitle: true,
          }),
        );
      }
    },
    [isHome, isInEdit],
    isHome,
  );

  useWebviewListener(
    "addModel",
    async () => {
      navigate(CONFIG_ROUTES.SETTINGS_ADD_PROVIDER);
    },
    [navigate],
  );

  useWebviewListener(
    "navigateTo",
    async (data) => {
      if (data.toggle && location.pathname === data.path) {
        navigate("/");
      } else {
        navigate(data.path);
      }
    },
    [location, navigate],
  );

  useWebviewListener(
    "setupLocalConfig",
    async () => {
      if (API_KEYS_FROM_ENV) {
        return;
      }
      onboardingCard.open(OnboardingModes.LOCAL);
    },
    [],
  );

  useWebviewListener(
    "setupApiKey",
    async () => {
      if (API_KEYS_FROM_ENV) {
        return;
      }
      onboardingCard.open(OnboardingModes.API_KEY);
    },
    [],
  );

  useWebviewListener(
    "focusEdit",
    async () => {
      await ideMessenger.request("edit/addCurrentSelection", undefined);
      await dispatch(enterEdit({ editorContent: mainEditor?.getJSON() }));
      mainEditor?.commands.focus();
    },
    [ideMessenger, mainEditor],
  );

  useWebviewListener(
    "setCodeToEdit",
    async (payload) => {
      dispatch(
        setCodeToEdit({
          codeToEdit: payload,
        }),
      );
    },
    [],
  );

  useWebviewListener(
    "exitEditMode",
    async () => {
      await dispatch(exitEdit({}));
    },
    [],
  );

  useEffect(() => {
    const handleKeyDown = (event: any) => {
      if (isMetaEquivalentKeyPressed(event) && event.code === "KeyC") {
        const selection = window.getSelection()?.toString();
        if (selection) {
          setTimeout(() => {
            void navigator.clipboard.writeText(selection);
          }, 100);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  useEffect(() => {
    if (
      isHome &&
      isNewUserOnboarding() &&
      shouldShowOnboardingCard(config, configLoading)
    ) {
      onboardingCard.open();
    }
  }, [isHome, config, configLoading]);

  return (
    <LocalStorageProvider>
      <AuthProvider>
        <LayoutTopDiv>
          <OSRContextMenu />
          {/* When TabBar is hidden (history/config), keep panel actions available. */}
          {!isHome && (
            <div
              className="pointer-events-auto absolute right-0 top-0 z-20"
              style={{ height: 35 }}
            >
              <ChatPanelTitleActions />
            </div>
          )}
          <div
            style={{
              scrollbarGutter: "stable both-edges",
              minHeight: "100%",
              display: "grid",
              gridTemplateRows: "1fr auto",
            }}
          >
            <TextDialog
              showDialog={showDialog}
              onEnter={() => {
                dispatch(setShowDialog(false));
              }}
              onClose={() => {
                dispatch(setShowDialog(false));
              }}
              message={dialogMessage}
            />

            <GridDiv>
              <Outlet />
              {!isHome && <FatalErrorIndicator />}
            </GridDiv>
          </div>
          <div style={{ fontSize: fontSize(-4) }} id="tooltip-portal-div" />
        </LayoutTopDiv>
      </AuthProvider>
    </LocalStorageProvider>
  );
};

export default Layout;
