/**
 * The glyph registry — every icon this application uses, as a token.
 *
 * ## What is in here, and why exactly this much
 *
 * 171 names, measured rather than curated: every identifier imported from
 * `lucide-react` anywhere in the tracked tree on 2026-09-05. Nothing was added
 * speculatively and nothing in use was left out, so `check:icon-contract` can
 * hold the campaign to "no file outside the design system imports the package"
 * without a single call site needing a glyph this file does not have.
 *
 * Adding one is two lines and no ceremony: import it aliased, export it wrapped.
 *
 * ## Two things the measurement found
 *
 * **33 of these names are lucide compatibility aliases.** `AlertCircle` is the
 * current `CircleAlert`, `Home` is `House`, `Filter` is `Funnel`,
 * `Loader2` is `LoaderCircle`. They still resolve, and the names below are the
 * ones this codebase actually writes, so those are the names the registry keeps
 * — see `glyph.js` for why the name is passed in rather than read off
 * `displayName`.
 *
 * **`UploadCloud` and `CloudUpload` are the same drawing.** The first is the
 * alias for the second, and both are in use. Both are exported here so no call
 * site has to change in order to be migrated; collapsing them is a Phase 7 tidy
 * rather than a blocker, and it is a rename with no visual consequence.
 */

import {
    Activity as LucideActivity, AlertCircle as LucideAlertCircle,
    AlertTriangle as LucideAlertTriangle, AlignCenter as LucideAlignCenter,
    AlignCenterVertical as LucideAlignCenterVertical,
    AlignEndVertical as LucideAlignEndVertical, AlignJustify as LucideAlignJustify,
    AlignLeft as LucideAlignLeft, AlignRight as LucideAlignRight,
    AlignStartVertical as LucideAlignStartVertical, Archive as LucideArchive,
    ArrowDown as LucideArrowDown, ArrowLeft as LucideArrowLeft,
    ArrowLeftRight as LucideArrowLeftRight, ArrowRight as LucideArrowRight,
    ArrowRightCircle as LucideArrowRightCircle, ArrowUp as LucideArrowUp,
    ArrowUpRight as LucideArrowUpRight, Ban as LucideBan, BarChart2 as LucideBarChart2,
    BarChart3 as LucideBarChart3, Beaker as LucideBeaker, Bell as LucideBell,
    BellPlus as LucideBellPlus, Blocks as LucideBlocks, Briefcase as LucideBriefcase,
    Building as LucideBuilding, Building2 as LucideBuilding2, Calendar as LucideCalendar,
    Check as LucideCheck, CheckCircle as LucideCheckCircle,
    CheckCircle2 as LucideCheckCircle2, CheckSquare as LucideCheckSquare,
    ChevronDown as LucideChevronDown, ChevronLeft as LucideChevronLeft,
    ChevronRight as LucideChevronRight, ChevronUp as LucideChevronUp,
    ChevronsLeft as LucideChevronsLeft, ChevronsRight as LucideChevronsRight,
    Circle as LucideCircle, CircleDot as LucideCircleDot,
    ClipboardList as LucideClipboardList, Clock as LucideClock,
    CloudUpload as LucideCloudUpload, Copy as LucideCopy, CopyPlus as LucideCopyPlus,
    CreditCard as LucideCreditCard, Crown as LucideCrown, Database as LucideDatabase,
    DatabaseZap as LucideDatabaseZap, Download as LucideDownload, Edit2 as LucideEdit2,
    Edit3 as LucideEdit3, Eraser as LucideEraser, ExternalLink as LucideExternalLink,
    Eye as LucideEye, EyeOff as LucideEyeOff, Facebook as LucideFacebook,
    FileCheck as LucideFileCheck, FilePlus2 as LucideFilePlus2,
    FileSignature as LucideFileSignature, FileSpreadsheet as LucideFileSpreadsheet,
    FileText as LucideFileText, Files as LucideFiles, Filter as LucideFilter,
    Fingerprint as LucideFingerprint, GitBranch as LucideGitBranch, Globe as LucideGlobe,
    Grid as LucideGrid, GripVertical as LucideGripVertical, HardDrive as LucideHardDrive,
    Hash as LucideHash, HelpCircle as LucideHelpCircle, History as LucideHistory,
    Home as LucideHome, Hourglass as LucideHourglass, Image as LucideImage,
    Inbox as LucideInbox, Info as LucideInfo, Key as LucideKey, KeyRound as LucideKeyRound,
    Layers as LucideLayers, LayoutDashboard as LucideLayoutDashboard,
    LayoutGrid as LucideLayoutGrid, LayoutTemplate as LucideLayoutTemplate,
    Link as LucideLink, Link2 as LucideLink2, List as LucideList,
    ListChecks as LucideListChecks, Loader as LucideLoader, Loader2 as LucideLoader2,
    Lock as LucideLock, LogOut as LucideLogOut, Mail as LucideMail,
    MailWarning as LucideMailWarning, MapPin as LucideMapPin, Maximize2 as LucideMaximize2,
    Medal as LucideMedal, Megaphone as LucideMegaphone, Menu as LucideMenu,
    MessageSquare as LucideMessageSquare, MinusCircle as LucideMinusCircle,
    MoreHorizontal as LucideMoreHorizontal, MoreVertical as LucideMoreVertical,
    MousePointerSquareDashed as LucideMousePointerSquareDashed,
    MoveHorizontal as LucideMoveHorizontal, MoveVertical as LucideMoveVertical,
    Newspaper as LucideNewspaper, Pause as LucidePause, PauseCircle as LucidePauseCircle,
    PenTool as LucidePenTool, Pencil as LucidePencil, PencilLine as LucidePencilLine,
    Phone as LucidePhone, Play as LucidePlay, Plug as LucidePlug, PlugZap as LucidePlugZap,
    Plus as LucidePlus, PlusCircle as LucidePlusCircle, PlusSquare as LucidePlusSquare,
    Printer as LucidePrinter, Redo2 as LucideRedo2, RefreshCcw as LucideRefreshCcw,
    RefreshCw as LucideRefreshCw, Rocket as LucideRocket, RotateCcw as LucideRotateCcw,
    Rows3 as LucideRows3, Ruler as LucideRuler, Save as LucideSave,
    Scaling as LucideScaling, ScrollText as LucideScrollText, Search as LucideSearch,
    Send as LucideSend, Server as LucideServer, ServerCog as LucideServerCog,
    Settings as LucideSettings, Settings2 as LucideSettings2, Share2 as LucideShare2,
    Shield as LucideShield, ShieldAlert as LucideShieldAlert,
    ShieldCheck as LucideShieldCheck, ShieldOff as LucideShieldOff,
    SlidersHorizontal as LucideSlidersHorizontal, Sparkles as LucideSparkles,
    Star as LucideStar, StickyNote as LucideStickyNote, Terminal as LucideTerminal,
    TestTube as LucideTestTube, ThumbsDown as LucideThumbsDown, Trash2 as LucideTrash2,
    TrendingUp as LucideTrendingUp, Trophy as LucideTrophy, Truck as LucideTruck,
    Type as LucideType, Undo2 as LucideUndo2, Unlock as LucideUnlock,
    Upload as LucideUpload, UploadCloud as LucideUploadCloud, User as LucideUser,
    UserCircle as LucideUserCircle, UserPlus as LucideUserPlus, Users as LucideUsers,
    Wand2 as LucideWand2, Wifi as LucideWifi, WifiOff as LucideWifiOff,
    Wrench as LucideWrench, X as LucideX, XCircle as LucideXCircle, Zap as LucideZap,
    ZoomIn as LucideZoomIn, ZoomOut as LucideZoomOut,
} from 'lucide-react';

import { glyph } from './glyph.js';

export const Activity = /* #__PURE__ */ glyph(LucideActivity, 'Activity');
export const AlertCircle = /* #__PURE__ */ glyph(LucideAlertCircle, 'AlertCircle');
export const AlertTriangle = /* #__PURE__ */ glyph(LucideAlertTriangle, 'AlertTriangle');
export const AlignCenter = /* #__PURE__ */ glyph(LucideAlignCenter, 'AlignCenter');
export const AlignCenterVertical = /* #__PURE__ */ glyph(LucideAlignCenterVertical, 'AlignCenterVertical');
export const AlignEndVertical = /* #__PURE__ */ glyph(LucideAlignEndVertical, 'AlignEndVertical');
export const AlignJustify = /* #__PURE__ */ glyph(LucideAlignJustify, 'AlignJustify');
export const AlignLeft = /* #__PURE__ */ glyph(LucideAlignLeft, 'AlignLeft');
export const AlignRight = /* #__PURE__ */ glyph(LucideAlignRight, 'AlignRight');
export const AlignStartVertical = /* #__PURE__ */ glyph(LucideAlignStartVertical, 'AlignStartVertical');
export const Archive = /* #__PURE__ */ glyph(LucideArchive, 'Archive');
export const ArrowDown = /* #__PURE__ */ glyph(LucideArrowDown, 'ArrowDown');
export const ArrowLeft = /* #__PURE__ */ glyph(LucideArrowLeft, 'ArrowLeft');
export const ArrowLeftRight = /* #__PURE__ */ glyph(LucideArrowLeftRight, 'ArrowLeftRight');
export const ArrowRight = /* #__PURE__ */ glyph(LucideArrowRight, 'ArrowRight');
export const ArrowRightCircle = /* #__PURE__ */ glyph(LucideArrowRightCircle, 'ArrowRightCircle');
export const ArrowUp = /* #__PURE__ */ glyph(LucideArrowUp, 'ArrowUp');
export const ArrowUpRight = /* #__PURE__ */ glyph(LucideArrowUpRight, 'ArrowUpRight');
export const Ban = /* #__PURE__ */ glyph(LucideBan, 'Ban');
export const BarChart2 = /* #__PURE__ */ glyph(LucideBarChart2, 'BarChart2');
export const BarChart3 = /* #__PURE__ */ glyph(LucideBarChart3, 'BarChart3');
export const Beaker = /* #__PURE__ */ glyph(LucideBeaker, 'Beaker');
export const Bell = /* #__PURE__ */ glyph(LucideBell, 'Bell');
export const BellPlus = /* #__PURE__ */ glyph(LucideBellPlus, 'BellPlus');
export const Blocks = /* #__PURE__ */ glyph(LucideBlocks, 'Blocks');
export const Briefcase = /* #__PURE__ */ glyph(LucideBriefcase, 'Briefcase');
export const Building = /* #__PURE__ */ glyph(LucideBuilding, 'Building');
export const Building2 = /* #__PURE__ */ glyph(LucideBuilding2, 'Building2');
export const Calendar = /* #__PURE__ */ glyph(LucideCalendar, 'Calendar');
export const Check = /* #__PURE__ */ glyph(LucideCheck, 'Check');
export const CheckCircle = /* #__PURE__ */ glyph(LucideCheckCircle, 'CheckCircle');
export const CheckCircle2 = /* #__PURE__ */ glyph(LucideCheckCircle2, 'CheckCircle2');
export const CheckSquare = /* #__PURE__ */ glyph(LucideCheckSquare, 'CheckSquare');
export const ChevronDown = /* #__PURE__ */ glyph(LucideChevronDown, 'ChevronDown');
export const ChevronLeft = /* #__PURE__ */ glyph(LucideChevronLeft, 'ChevronLeft');
export const ChevronRight = /* #__PURE__ */ glyph(LucideChevronRight, 'ChevronRight');
export const ChevronUp = /* #__PURE__ */ glyph(LucideChevronUp, 'ChevronUp');
export const ChevronsLeft = /* #__PURE__ */ glyph(LucideChevronsLeft, 'ChevronsLeft');
export const ChevronsRight = /* #__PURE__ */ glyph(LucideChevronsRight, 'ChevronsRight');
export const Circle = /* #__PURE__ */ glyph(LucideCircle, 'Circle');
export const CircleDot = /* #__PURE__ */ glyph(LucideCircleDot, 'CircleDot');
export const ClipboardList = /* #__PURE__ */ glyph(LucideClipboardList, 'ClipboardList');
export const Clock = /* #__PURE__ */ glyph(LucideClock, 'Clock');
export const CloudUpload = /* #__PURE__ */ glyph(LucideCloudUpload, 'CloudUpload');
export const Copy = /* #__PURE__ */ glyph(LucideCopy, 'Copy');
export const CopyPlus = /* #__PURE__ */ glyph(LucideCopyPlus, 'CopyPlus');
export const CreditCard = /* #__PURE__ */ glyph(LucideCreditCard, 'CreditCard');
export const Crown = /* #__PURE__ */ glyph(LucideCrown, 'Crown');
export const Database = /* #__PURE__ */ glyph(LucideDatabase, 'Database');
export const DatabaseZap = /* #__PURE__ */ glyph(LucideDatabaseZap, 'DatabaseZap');
export const Download = /* #__PURE__ */ glyph(LucideDownload, 'Download');
export const Edit2 = /* #__PURE__ */ glyph(LucideEdit2, 'Edit2');
export const Edit3 = /* #__PURE__ */ glyph(LucideEdit3, 'Edit3');
export const Eraser = /* #__PURE__ */ glyph(LucideEraser, 'Eraser');
export const ExternalLink = /* #__PURE__ */ glyph(LucideExternalLink, 'ExternalLink');
export const Eye = /* #__PURE__ */ glyph(LucideEye, 'Eye');
export const EyeOff = /* #__PURE__ */ glyph(LucideEyeOff, 'EyeOff');
export const Facebook = /* #__PURE__ */ glyph(LucideFacebook, 'Facebook');
export const FileCheck = /* #__PURE__ */ glyph(LucideFileCheck, 'FileCheck');
export const FilePlus2 = /* #__PURE__ */ glyph(LucideFilePlus2, 'FilePlus2');
export const FileSignature = /* #__PURE__ */ glyph(LucideFileSignature, 'FileSignature');
export const FileSpreadsheet = /* #__PURE__ */ glyph(LucideFileSpreadsheet, 'FileSpreadsheet');
export const FileText = /* #__PURE__ */ glyph(LucideFileText, 'FileText');
export const Files = /* #__PURE__ */ glyph(LucideFiles, 'Files');
export const Filter = /* #__PURE__ */ glyph(LucideFilter, 'Filter');
export const Fingerprint = /* #__PURE__ */ glyph(LucideFingerprint, 'Fingerprint');
export const GitBranch = /* #__PURE__ */ glyph(LucideGitBranch, 'GitBranch');
export const Globe = /* #__PURE__ */ glyph(LucideGlobe, 'Globe');
export const Grid = /* #__PURE__ */ glyph(LucideGrid, 'Grid');
export const GripVertical = /* #__PURE__ */ glyph(LucideGripVertical, 'GripVertical');
export const HardDrive = /* #__PURE__ */ glyph(LucideHardDrive, 'HardDrive');
export const Hash = /* #__PURE__ */ glyph(LucideHash, 'Hash');
export const HelpCircle = /* #__PURE__ */ glyph(LucideHelpCircle, 'HelpCircle');
export const History = /* #__PURE__ */ glyph(LucideHistory, 'History');
export const Home = /* #__PURE__ */ glyph(LucideHome, 'Home');
export const Hourglass = /* #__PURE__ */ glyph(LucideHourglass, 'Hourglass');
export const Image = /* #__PURE__ */ glyph(LucideImage, 'Image');
export const Inbox = /* #__PURE__ */ glyph(LucideInbox, 'Inbox');
export const Info = /* #__PURE__ */ glyph(LucideInfo, 'Info');
export const Key = /* #__PURE__ */ glyph(LucideKey, 'Key');
export const KeyRound = /* #__PURE__ */ glyph(LucideKeyRound, 'KeyRound');
export const Layers = /* #__PURE__ */ glyph(LucideLayers, 'Layers');
export const LayoutDashboard = /* #__PURE__ */ glyph(LucideLayoutDashboard, 'LayoutDashboard');
export const LayoutGrid = /* #__PURE__ */ glyph(LucideLayoutGrid, 'LayoutGrid');
export const LayoutTemplate = /* #__PURE__ */ glyph(LucideLayoutTemplate, 'LayoutTemplate');
export const Link = /* #__PURE__ */ glyph(LucideLink, 'Link');
export const Link2 = /* #__PURE__ */ glyph(LucideLink2, 'Link2');
export const List = /* #__PURE__ */ glyph(LucideList, 'List');
export const ListChecks = /* #__PURE__ */ glyph(LucideListChecks, 'ListChecks');
export const Loader = /* #__PURE__ */ glyph(LucideLoader, 'Loader');
export const Loader2 = /* #__PURE__ */ glyph(LucideLoader2, 'Loader2');
export const Lock = /* #__PURE__ */ glyph(LucideLock, 'Lock');
export const LogOut = /* #__PURE__ */ glyph(LucideLogOut, 'LogOut');
export const Mail = /* #__PURE__ */ glyph(LucideMail, 'Mail');
export const MailWarning = /* #__PURE__ */ glyph(LucideMailWarning, 'MailWarning');
export const MapPin = /* #__PURE__ */ glyph(LucideMapPin, 'MapPin');
export const Maximize2 = /* #__PURE__ */ glyph(LucideMaximize2, 'Maximize2');
export const Medal = /* #__PURE__ */ glyph(LucideMedal, 'Medal');
export const Megaphone = /* #__PURE__ */ glyph(LucideMegaphone, 'Megaphone');
export const Menu = /* #__PURE__ */ glyph(LucideMenu, 'Menu');
export const MessageSquare = /* #__PURE__ */ glyph(LucideMessageSquare, 'MessageSquare');
export const MinusCircle = /* #__PURE__ */ glyph(LucideMinusCircle, 'MinusCircle');
export const MoreHorizontal = /* #__PURE__ */ glyph(LucideMoreHorizontal, 'MoreHorizontal');
export const MoreVertical = /* #__PURE__ */ glyph(LucideMoreVertical, 'MoreVertical');
export const MousePointerSquareDashed = /* #__PURE__ */ glyph(LucideMousePointerSquareDashed, 'MousePointerSquareDashed');
export const MoveHorizontal = /* #__PURE__ */ glyph(LucideMoveHorizontal, 'MoveHorizontal');
export const MoveVertical = /* #__PURE__ */ glyph(LucideMoveVertical, 'MoveVertical');
export const Newspaper = /* #__PURE__ */ glyph(LucideNewspaper, 'Newspaper');
export const Pause = /* #__PURE__ */ glyph(LucidePause, 'Pause');
export const PauseCircle = /* #__PURE__ */ glyph(LucidePauseCircle, 'PauseCircle');
export const PenTool = /* #__PURE__ */ glyph(LucidePenTool, 'PenTool');
export const Pencil = /* #__PURE__ */ glyph(LucidePencil, 'Pencil');
export const PencilLine = /* #__PURE__ */ glyph(LucidePencilLine, 'PencilLine');
export const Phone = /* #__PURE__ */ glyph(LucidePhone, 'Phone');
export const Play = /* #__PURE__ */ glyph(LucidePlay, 'Play');
export const Plug = /* #__PURE__ */ glyph(LucidePlug, 'Plug');
export const PlugZap = /* #__PURE__ */ glyph(LucidePlugZap, 'PlugZap');
export const Plus = /* #__PURE__ */ glyph(LucidePlus, 'Plus');
export const PlusCircle = /* #__PURE__ */ glyph(LucidePlusCircle, 'PlusCircle');
export const PlusSquare = /* #__PURE__ */ glyph(LucidePlusSquare, 'PlusSquare');
export const Printer = /* #__PURE__ */ glyph(LucidePrinter, 'Printer');
export const Redo2 = /* #__PURE__ */ glyph(LucideRedo2, 'Redo2');
export const RefreshCcw = /* #__PURE__ */ glyph(LucideRefreshCcw, 'RefreshCcw');
export const RefreshCw = /* #__PURE__ */ glyph(LucideRefreshCw, 'RefreshCw');
export const Rocket = /* #__PURE__ */ glyph(LucideRocket, 'Rocket');
export const RotateCcw = /* #__PURE__ */ glyph(LucideRotateCcw, 'RotateCcw');
export const Rows3 = /* #__PURE__ */ glyph(LucideRows3, 'Rows3');
export const Ruler = /* #__PURE__ */ glyph(LucideRuler, 'Ruler');
export const Save = /* #__PURE__ */ glyph(LucideSave, 'Save');
export const Scaling = /* #__PURE__ */ glyph(LucideScaling, 'Scaling');
export const ScrollText = /* #__PURE__ */ glyph(LucideScrollText, 'ScrollText');
export const Search = /* #__PURE__ */ glyph(LucideSearch, 'Search');
export const Send = /* #__PURE__ */ glyph(LucideSend, 'Send');
export const Server = /* #__PURE__ */ glyph(LucideServer, 'Server');
export const ServerCog = /* #__PURE__ */ glyph(LucideServerCog, 'ServerCog');
export const Settings = /* #__PURE__ */ glyph(LucideSettings, 'Settings');
export const Settings2 = /* #__PURE__ */ glyph(LucideSettings2, 'Settings2');
export const Share2 = /* #__PURE__ */ glyph(LucideShare2, 'Share2');
export const Shield = /* #__PURE__ */ glyph(LucideShield, 'Shield');
export const ShieldAlert = /* #__PURE__ */ glyph(LucideShieldAlert, 'ShieldAlert');
export const ShieldCheck = /* #__PURE__ */ glyph(LucideShieldCheck, 'ShieldCheck');
export const ShieldOff = /* #__PURE__ */ glyph(LucideShieldOff, 'ShieldOff');
export const SlidersHorizontal = /* #__PURE__ */ glyph(LucideSlidersHorizontal, 'SlidersHorizontal');
export const Sparkles = /* #__PURE__ */ glyph(LucideSparkles, 'Sparkles');
export const Star = /* #__PURE__ */ glyph(LucideStar, 'Star');
export const StickyNote = /* #__PURE__ */ glyph(LucideStickyNote, 'StickyNote');
export const Terminal = /* #__PURE__ */ glyph(LucideTerminal, 'Terminal');
export const TestTube = /* #__PURE__ */ glyph(LucideTestTube, 'TestTube');
export const ThumbsDown = /* #__PURE__ */ glyph(LucideThumbsDown, 'ThumbsDown');
export const Trash2 = /* #__PURE__ */ glyph(LucideTrash2, 'Trash2');
export const TrendingUp = /* #__PURE__ */ glyph(LucideTrendingUp, 'TrendingUp');
export const Trophy = /* #__PURE__ */ glyph(LucideTrophy, 'Trophy');
export const Truck = /* #__PURE__ */ glyph(LucideTruck, 'Truck');
export const Type = /* #__PURE__ */ glyph(LucideType, 'Type');
export const Undo2 = /* #__PURE__ */ glyph(LucideUndo2, 'Undo2');
export const Unlock = /* #__PURE__ */ glyph(LucideUnlock, 'Unlock');
export const Upload = /* #__PURE__ */ glyph(LucideUpload, 'Upload');
export const UploadCloud = /* #__PURE__ */ glyph(LucideUploadCloud, 'UploadCloud');
export const User = /* #__PURE__ */ glyph(LucideUser, 'User');
export const UserCircle = /* #__PURE__ */ glyph(LucideUserCircle, 'UserCircle');
export const UserPlus = /* #__PURE__ */ glyph(LucideUserPlus, 'UserPlus');
export const Users = /* #__PURE__ */ glyph(LucideUsers, 'Users');
export const Wand2 = /* #__PURE__ */ glyph(LucideWand2, 'Wand2');
export const Wifi = /* #__PURE__ */ glyph(LucideWifi, 'Wifi');
export const WifiOff = /* #__PURE__ */ glyph(LucideWifiOff, 'WifiOff');
export const Wrench = /* #__PURE__ */ glyph(LucideWrench, 'Wrench');
export const X = /* #__PURE__ */ glyph(LucideX, 'X');
export const XCircle = /* #__PURE__ */ glyph(LucideXCircle, 'XCircle');
export const Zap = /* #__PURE__ */ glyph(LucideZap, 'Zap');
export const ZoomIn = /* #__PURE__ */ glyph(LucideZoomIn, 'ZoomIn');
export const ZoomOut = /* #__PURE__ */ glyph(LucideZoomOut, 'ZoomOut');

/**
 * Every glyph name the registry exports, sorted — what `check:icon-contract`
 * and the tests read so neither re-derives it, and what a call site greps to
 * find out whether a name is already available.
 */
export const GLYPH_NAMES = Object.freeze([
    'Activity', 'AlertCircle', 'AlertTriangle', 'AlignCenter', 'AlignCenterVertical',
    'AlignEndVertical', 'AlignJustify', 'AlignLeft', 'AlignRight', 'AlignStartVertical',
    'Archive', 'ArrowDown', 'ArrowLeft', 'ArrowLeftRight', 'ArrowRight', 'ArrowRightCircle',
    'ArrowUp', 'ArrowUpRight', 'Ban', 'BarChart2', 'BarChart3', 'Beaker', 'Bell',
    'BellPlus', 'Blocks', 'Briefcase', 'Building', 'Building2', 'Calendar', 'Check',
    'CheckCircle', 'CheckCircle2', 'CheckSquare', 'ChevronDown', 'ChevronLeft',
    'ChevronRight', 'ChevronUp', 'ChevronsLeft', 'ChevronsRight', 'Circle', 'CircleDot',
    'ClipboardList', 'Clock', 'CloudUpload', 'Copy', 'CopyPlus', 'CreditCard', 'Crown',
    'Database', 'DatabaseZap', 'Download', 'Edit2', 'Edit3', 'Eraser', 'ExternalLink',
    'Eye', 'EyeOff', 'Facebook', 'FileCheck', 'FilePlus2', 'FileSignature',
    'FileSpreadsheet', 'FileText', 'Files', 'Filter', 'Fingerprint', 'GitBranch', 'Globe',
    'Grid', 'GripVertical', 'HardDrive', 'Hash', 'HelpCircle', 'History', 'Home',
    'Hourglass', 'Image', 'Inbox', 'Info', 'Key', 'KeyRound', 'Layers', 'LayoutDashboard',
    'LayoutGrid', 'LayoutTemplate', 'Link', 'Link2', 'List', 'ListChecks', 'Loader',
    'Loader2', 'Lock', 'LogOut', 'Mail', 'MailWarning', 'MapPin', 'Maximize2', 'Medal',
    'Megaphone', 'Menu', 'MessageSquare', 'MinusCircle', 'MoreHorizontal', 'MoreVertical',
    'MousePointerSquareDashed', 'MoveHorizontal', 'MoveVertical', 'Newspaper', 'Pause',
    'PauseCircle', 'PenTool', 'Pencil', 'PencilLine', 'Phone', 'Play', 'Plug', 'PlugZap',
    'Plus', 'PlusCircle', 'PlusSquare', 'Printer', 'Redo2', 'RefreshCcw', 'RefreshCw',
    'Rocket', 'RotateCcw', 'Rows3', 'Ruler', 'Save', 'Scaling', 'ScrollText', 'Search',
    'Send', 'Server', 'ServerCog', 'Settings', 'Settings2', 'Share2', 'Shield',
    'ShieldAlert', 'ShieldCheck', 'ShieldOff', 'SlidersHorizontal', 'Sparkles', 'Star',
    'StickyNote', 'Terminal', 'TestTube', 'ThumbsDown', 'Trash2', 'TrendingUp', 'Trophy',
    'Truck', 'Type', 'Undo2', 'Unlock', 'Upload', 'UploadCloud', 'User', 'UserCircle',
    'UserPlus', 'Users', 'Wand2', 'Wifi', 'WifiOff', 'Wrench', 'X', 'XCircle', 'Zap',
    'ZoomIn', 'ZoomOut',
]);
